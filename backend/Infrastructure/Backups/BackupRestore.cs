using System.Diagnostics;
using System.Globalization;
using api_v2.Application.Health;
using api_v2.Infrastructure.Configuration;
using api_v2.Infrastructure.Persistence;
using api_v2.Application.Exceptions;
using api_v2.Application.Ports;
using api_v2.Domain.Rules;
using Npgsql;
using api_v2.Application.Rules;

namespace api_v2.Infrastructure.Backups;

// Puts the data back the way it was in a backup: the industries, their rules (the Fields), and every table from the
// Tables page with its columns and rows. Only the data travels in time. Accounts, sign ins, notes, the Scratchpad,
// requests and app settings are always current, so they stay as they are now.
//
// How it works: the dump is loaded into a scratch database on the same server first, so a dump that can't be
// read never touches the live one. Then rows and rules are copied over in one transaction,
// so the live table is either fully swapped or not changed at all. A copy of the table goes to the collector
// before the swap, and a full backup is taken too (kind before-restore), so the whole restore can be undone by restoring that.
public sealed class BackupRestore(
    BackupService backups,
    DatabaseConnections connections,
    DatabaseStatus status,
    CollectorStore collector,
    RulesService rules,
    AppLocks locks,
    IServiceScopeFactory scopes,
    ILogger<BackupRestore> log) : IBackupRestore
{
    // The data tables, the only ones that come back from a backup. Accounts would bring back old passwords and sign
    // everyone out; notes, the Scratchpad, requests and app settings belong to now, so they stay too.
    // UserTables comes before UserTableRows: emptying it empties the rows (cascade), and the rows need their table back first.
    private static readonly string[] Tables = ["Industries", "RuleVersions", "UserTables", "UserTableRows"];

    private const string ScratchDatabase = "main_restore_scratch";
    private static readonly TimeSpan Timeout = TimeSpan.FromMinutes(10);

    public const string LayoutMessage =
        "That backup was made when the table had a different layout, so it can't be restored from the page. Nothing was changed";

    // True when the backup's layout matches today's database, null when the backup didn't record it
    public string PlainMessage(Exception ex) => backups.PlainMessage(ex);

    public bool? SameLayout(BackupEntry entry) =>
        entry.Migrations is null ? null : status.SameLayout(entry.Migrations);

    public async Task<BackupRestoreResult> RunAsync(string id, string by, CancellationToken ct)
    {
        var entry = backups.Find(id) ?? throw new BackupRefusedException($"No backup called {id} exists. Nothing was changed");
        var dump = backups.ResolveDump(id, "main");
        if (dump is null || !File.Exists(dump))
        {
            throw new BackupRefusedException($"Backup \"{id}\" has no copy of the main database");
        }
        if (SameLayout(entry) == false)
        {
            throw new BackupRefusedException(LayoutMessage);
        }
        var tool = backups.ResolveRestoreTool();

        // Nothing else may change rows or rules while the swap runs
        await using var tableLock = await locks.TakeAsync(AppLock.Table, ct);
        await using var rulesLock = await locks.TakeAsync(AppLock.Rules, ct);

        // A long command timeout on both sides, a big table takes longer than the 30 seconds a query normally gets.
        // No pooling for the scratch database: it gets dropped at the end, and a pooled connection to it would come back dead.
        var scratch = new NpgsqlConnectionStringBuilder(connections.Main)
        {
            Database = ScratchDatabase, CommandTimeout = (int)Timeout.TotalSeconds, Pooling = false
        };
        await DropScratchAsync(ct);
        await CreateScratchAsync(ct);
        try
        {
            await CopyNameRuleAsync(scratch, ct);

            // pg_restore reads a path, so the sealed dump is opened into a plain copy for the length of the load
            var plain = await backups.DecryptToTempAsync(dump, ct);
            try
            {
                await LoadDumpAsync(tool, scratch, plain, ct);
            }
            finally
            {
                BackupService.DeletePlainCopy(plain);
            }

            await using var source = new NpgsqlConnection(scratch.ConnectionString);
            await source.OpenAsync(ct);

            // The dump's own record of its layout is what counts, backup.json is only the quick check
            var dumped = await MigrationsAsync(source, ct);
            if (!status.SameLayout(dumped))
            {
                throw new BackupRefusedException(LayoutMessage);
            }

            // A full copy of everything as it is now, the History copy below only covers the industries
            string undoBackup;
            try
            {
                undoBackup = (await backups.RunAsync("before-restore", by, ct))!.Id;
            }
            catch (BackupBusyException)
            {
                throw new BackupRefusedException("Another backup is running. Nothing was restored. Try again in a minute");
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogError(ex, "Full copy before restoring backup {Backup} failed", id);
                throw new BackupFailedException("Couldn't save a full copy first, so nothing was restored. The details are in the API log");
            }

            long? copyId;
            try
            {
                copyId = await collector.SaveVersionAsync($"Before restoring backup {id}", by, ct, applyRetention: false);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogError(ex, "Copy before restoring backup {Backup} failed", id);
                throw new BackupFailedException("Couldn't save a copy of the table first, so nothing was restored. Try again in a moment");
            }

            int rowsBefore, rows;
            try
            {
                (rowsBefore, rows) = await SwapAsync(source, ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // The live table is as it was, so the copy of it isn't needed
                if (copyId is long unused) await collector.DeleteVersionAsync(unused);
                log.LogError(ex, "Restoring backup {Backup} failed, the table is unchanged", id);
                throw new BackupFailedException("The restore didn't finish and the table is unchanged, the details are in the API log");
            }

            await ReloadAsync(ct);
            try
            {
                await collector.LogChangeAsync(null, "restore-backup", new { Rows = rowsBefore },
                    new { Backup = id, Rows = rows }, rules.Current.Version, by, "done", ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogWarning(ex, "The restore went through but the collector log failed");
            }
            log.LogInformation("Restored backup {Backup}: {Rows} rows, rules version {Version}", id, rows, rules.Current.Version);
            return new BackupRestoreResult(id, rowsBefore, rows, rules.Current.Version, copyId, undoBackup);
        }
        finally
        {
            await DropScratchAsync(CancellationToken.None);
        }
    }

    // Everything the page and the API keep in memory about the table is read again from the database
    private async Task ReloadAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var admin = scope.ServiceProvider.GetRequiredService<RulesAdminService>();
        await admin.LoadAsync(ct);
    }

    // Empties the live tables and copies the scratch rows in, in one transaction. Returns rows before and after.
    private async Task<(int Before, int After)> SwapAsync(NpgsqlConnection source, CancellationToken ct)
    {
        var live = new NpgsqlConnectionStringBuilder(connections.Main) { CommandTimeout = (int)Timeout.TotalSeconds, Pooling = false };
        await using var target = new NpgsqlConnection(live.ConnectionString);
        await target.OpenAsync(ct);
        await using var tx = await target.BeginTransactionAsync(ct);

        var before = await CountAsync(target, tx, "Industries", ct);

        foreach (var table in Tables)
        {
            var columns = await ColumnsAsync(source, table, ct);
            var inTarget = await ColumnsAsync(target, table, ct, tx);
            if (!columns.SequenceEqual(inTarget))
            {
                throw new BackupRefusedException(LayoutMessage);
            }
            var list = string.Join(", ", columns.Select(c => $"\"{c}\""));

            await using (var clear = new NpgsqlCommand($"""DELETE FROM "{table}" """, target, tx))
            {
                await clear.ExecuteNonQueryAsync(ct);
            }

            // Binary COPY out of the scratch database straight into the live one, same columns in the same order
            await using var export = await source.BeginRawBinaryCopyAsync($"""COPY "{table}" ({list}) TO STDOUT (FORMAT BINARY)""", ct);
            var import = await target.BeginRawBinaryCopyAsync($"""COPY "{table}" ({list}) FROM STDIN (FORMAT BINARY)""", ct);
            try
            {
                await export.CopyToAsync(import, ct);
            }
            catch
            {
                import.Cancel();
                throw;
            }
            await import.DisposeAsync();
        }

        // New rows carry on after the highest restored id
        foreach (var table in Tables)
        {
            await using var seq = new NpgsqlCommand($"""
                SELECT setval(pg_get_serial_sequence('"{table}"', 'Id'), coalesce((SELECT max("Id") FROM "{table}"), 0) + 1, false)
                """, target, tx);
            await seq.ExecuteScalarAsync(ct);
        }

        var after = await CountAsync(target, tx, "Industries", ct);
        await tx.CommitAsync(ct);
        return (before, after);
    }

    private static async Task<int> CountAsync(NpgsqlConnection conn, NpgsqlTransaction? tx, string table, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand($"""SELECT count(*)::int FROM "{table}" """, conn, tx);
        return (int)(await cmd.ExecuteScalarAsync(ct))!;
    }

    private static async Task<List<string>> ColumnsAsync(NpgsqlConnection conn, string table, CancellationToken ct, NpgsqlTransaction? tx = null)
    {
        await using var cmd = new NpgsqlCommand(
            "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = @table ORDER BY ordinal_position", conn, tx);
        cmd.Parameters.AddWithValue("table", table);
        var columns = new List<string>();
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct)) columns.Add(reader.GetString(0));
        if (columns.Count == 0) throw new BackupRefusedException(LayoutMessage);
        return columns;
    }

    private static async Task<HashSet<string>> MigrationsAsync(NpgsqlConnection conn, CancellationToken ct)
    {
        var found = new HashSet<string>();
        await using var exists = new NpgsqlCommand("SELECT to_regclass('public.\"__EFMigrationsHistory\"') IS NOT NULL", conn);
        if (!(bool)(await exists.ExecuteScalarAsync(ct))!) return found;
        await using var cmd = new NpgsqlCommand("""SELECT "MigrationId" FROM "__EFMigrationsHistory" """, conn);
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct)) found.Add(reader.GetString(0));
        return found;
    }

    private NpgsqlConnectionStringBuilder Server() =>
        new(connections.Main) { Database = "postgres" };

    private async Task CreateScratchAsync(CancellationToken ct)
    {
        await using var conn = new NpgsqlConnection(Server().ConnectionString);
        await conn.OpenAsync(ct);
        await using var cmd = new NpgsqlCommand($"CREATE DATABASE \"{ScratchDatabase}\"", conn);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    // pg_dump writes only the tables it is asked for, and the collation the Industries and Users indexes use isn't one of
    // them. The scratch database gets the live collation first, or those indexes can't be made from the dump.
    private async Task CopyNameRuleAsync(NpgsqlConnectionStringBuilder scratch, CancellationToken ct)
    {
        string? create = null;
        await using (var live = new NpgsqlConnection(connections.Main))
        {
            await live.OpenAsync(ct);
            await using var cmd = new NpgsqlCommand("""
                SELECT c.collprovider, c.colllocale, c.collisdeterministic
                FROM pg_collation c JOIN pg_namespace n ON n.oid = c.collnamespace
                WHERE n.nspname = 'public' AND c.collname = 'name_rule'
                """, live);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            if (await reader.ReadAsync(ct))
            {
                // Only the ICU kind is made by the migration, anything else would be a different rule
                if (reader.GetChar(0) != 'i') throw new BackupFailedException("The name rule isn't an ICU collation, so this backup can't be restored here. Nothing was changed");
                var locale = reader.GetString(1).Replace("'", "''");
                create = $"CREATE COLLATION public.name_rule (provider = icu, locale = '{locale}', deterministic = {(reader.GetBoolean(2) ? "true" : "false")})";
            }
        }
        if (create is null) return;

        await using var target = new NpgsqlConnection(scratch.ConnectionString);
        await target.OpenAsync(ct);
        await using var make = new NpgsqlCommand(create, target);
        await make.ExecuteNonQueryAsync(ct);
    }

    // A scratch database left behind by a crash is dropped before and after every restore
    private async Task DropScratchAsync(CancellationToken ct)
    {
        try
        {
            await using var conn = new NpgsqlConnection(Server().ConnectionString);
            await conn.OpenAsync(ct);
            await using var cmd = new NpgsqlCommand($"DROP DATABASE IF EXISTS \"{ScratchDatabase}\" WITH (FORCE)", conn);
            await cmd.ExecuteNonQueryAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "Couldn't remove the scratch database {Database}, it's removed on the next restore", ScratchDatabase);
        }
    }

    // pg_restore into the scratch database. Its own words only go to the log.
    private async Task LoadDumpAsync(DatabaseTool tool, NpgsqlConnectionStringBuilder db, string dump, CancellationToken ct)
    {
        var psi = new ProcessStartInfo
        {
            FileName = tool.Docker ? "docker" : tool.Path!,
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };

        if (tool.Docker)
        {
            psi.ArgumentList.Add("exec");
            psi.ArgumentList.Add("-i");
            if (!string.IsNullOrEmpty(db.Password))
            {
                psi.ArgumentList.Add("-e");
                psi.ArgumentList.Add("PGPASSWORD");
            }
            psi.ArgumentList.Add("stock-listing-db");
            psi.ArgumentList.Add("pg_restore");
        }

        psi.ArgumentList.Add("--no-owner");
        psi.ArgumentList.Add("--no-privileges");
        psi.ArgumentList.Add("--exit-on-error");
        if (!tool.Docker)
        {
            psi.ArgumentList.Add("-h");
            psi.ArgumentList.Add(string.IsNullOrEmpty(db.Host) ? "localhost" : db.Host);
            psi.ArgumentList.Add("-p");
            psi.ArgumentList.Add(db.Port.ToString(CultureInfo.InvariantCulture));
        }
        psi.ArgumentList.Add("-U");
        psi.ArgumentList.Add(db.Username ?? "");
        psi.ArgumentList.Add("-d");
        psi.ArgumentList.Add(db.Database ?? "");
        if (!tool.Docker)
        {
            // The file goes in by name here. In Docker it goes in on stdin, since the file isn't inside the container.
            psi.ArgumentList.Add(dump);
        }
        if (!string.IsNullOrEmpty(db.Password))
        {
            psi.Environment["PGPASSWORD"] = db.Password;
        }

        using var process = new Process { StartInfo = psi };
        try
        {
            if (!process.Start()) throw new BackupFailedException("The restore program didn't start");
        }
        catch (System.ComponentModel.Win32Exception ex)
        {
            log.LogError(ex, "Couldn't start {Program}", psi.FileName);
            throw new BackupFailedException(BackupService.MissingRestoreToolMessage);
        }

        var stderrTask = process.StandardError.ReadToEndAsync(ct);
        var stdoutTask = process.StandardOutput.ReadToEndAsync(ct);
        using var timeout = new CancellationTokenSource(Timeout);
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, timeout.Token);
        try
        {
            if (tool.Docker)
            {
                await using var file = File.OpenRead(dump);
                await file.CopyToAsync(process.StandardInput.BaseStream, linked.Token);
            }
            process.StandardInput.Close();
            await process.WaitForExitAsync(linked.Token);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            Kill(process);
            log.LogError("pg_restore of {Dump} timed out", dump);
            throw new BackupFailedException("Reading the backup took too long and was stopped. Nothing was changed");
        }

        var stderr = await ReadQuiet(stderrTask);
        await ReadQuiet(stdoutTask);
        if (process.ExitCode != 0)
        {
            log.LogError("pg_restore of {Dump} failed with code {Code}: {Detail}", dump, process.ExitCode, stderr.Trim());
            throw new BackupFailedException("Couldn't read that backup, the details are in the API log. Nothing was changed");
        }
    }

    private static void Kill(Process process)
    {
        try
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
        }
        catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception)
        {
        }
    }

    private static async Task<string> ReadQuiet(Task<string> task)
    {
        try
        {
            return await task;
        }
        catch (Exception ex) when (ex is OperationCanceledException or IOException)
        {
            return "";
        }
    }
}
