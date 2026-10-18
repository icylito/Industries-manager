using System.Diagnostics;
using System.Globalization;
using System.IO.Compression;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using api_v2.Application.Health;
using api_v2.Infrastructure.Configuration;
using api_v2.Infrastructure.Export;
using api_v2.Domain.Rules;
using Npgsql;
using api_v2.Infrastructure.Security;

namespace api_v2.Application.Backups;

// Thrown when a second backup is asked for while one is already running.
public sealed class BackupBusyException : Exception
{
    public BackupBusyException() : base("A backup is already running, try again in a minute") { }
}

// A backup or restore that stopped for a reason the page can show as it is. Anything else only goes to the log.
public sealed class BackupFailedException(string message) : Exception(message);

// An uploaded backup file that was turned away, with the status the page should get. The message is shown as it is.
public sealed class BackupUploadException(string message, int status) : Exception(message)
{
    public int Status { get; } = status;

    // The backup already in the list, when the file is one of those. The page scrolls to it.
    public string? ExistingId { get; init; }
}

// Where pg_dump and pg_restore live. Docker means they run inside the database container.
public readonly record struct DatabaseTool(bool Docker, string? Path)
{
    public static DatabaseTool FromFile(string path) => new(false, path);
    public static DatabaseTool InDocker() => new(true, null);
}

// One saved backup, what GET /backups lists and what POST /backups returns.
public sealed record BackupEntry(
    string Id,
    DateTimeOffset CreatedAt,
    string Kind,
    string By,
    long MainSize,
    long CollectorSize,
    int RulesVersion,
    bool HasExcel,
    // Rows in the table when the copy was made. Backups from before this was recorded don't have it.
    int? RowCount = null,
    // The database layout at the time, so a restore knows if the table looked the same
    List<string>? Migrations = null,
    // Set for a backup that was dropped in from a file. It is kept 14 days from then, not from when it was made.
    DateTimeOffset? UploadedAt = null,
    // Has a signature.json, so its zip can be dropped back in. Backups from before signing don't.
    bool Signed = false);

// Runs pg_dump for main and the collector, one backup at a time.
public sealed class BackupService(
    IConfiguration config,
    IWebHostEnvironment env,
    DatabaseConnections connections,
    DatabaseStatus status,
    RulesService rules,
    BackupSigner signer,
    ILogger<BackupService> log)
{
    public const string MissingToolMessage =
        "Backups need pg_dump. Install the Postgres tools or set Backup:PgDump in appsettings";

    public const string MissingConfiguredToolMessage =
        "Backup:PgDump is set, but that file doesn't exist";

    public const string MissingRestoreToolMessage =
        "Restoring needs pg_restore, which comes with Postgres next to pg_dump";

    // The table as a CSV that opens in Excel. Backups from before it existed don't have one.
    public const string ExcelFile = "main.csv";

    // What main.dump keeps: the industries and their rules, the Tables page, the accounts and their pictures, and the
    // migration record the restore checks the layout with. Scratchpad, notes, requests, settings and sessions are not
    // part of a backup, they are never brought back.
    private static readonly string[] DumpedTables =
        ["Industries", "RuleVersions", "UserTables", "UserTableRows", "Users", "UserAvatars", "__EFMigrationsHistory"];

    // The start of a plain copy of a backup, made in the backups folder while pg_restore reads it
    private const string PlainPrefix = ".plain-";

    private static readonly Regex IdPattern = new(
        @"^\d{4}-\d{2}-\d{2}_\d{6}_(nightly|manual|before-restore|uploaded)$",
        RegexOptions.CultureInvariant | RegexOptions.Compiled);

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = true
    };

    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly object _statusLock = new();
    private readonly string _folder = ResolveFolder(config, env);
    private readonly string? _pgDumpSetting = BlankToNull(config["Backup:PgDump"]);
    private readonly int _keepDays = ReadKeepDays(config);
    private string? _lastError;
    private DateTimeOffset? _lastErrorAt;
    private bool _running;

    public TimeSpan NightlyTime { get; } = ReadTime(config);

    public static bool ValidId(string? id) => id is not null && IdPattern.IsMatch(id);

    // What the page may show about a failure. Only messages this code wrote itself, never a tool's or the framework's.
    public static string PlainMessage(Exception ex) =>
        ex is BackupFailedException or BackupBusyException ? ex.Message : "Something went wrong. Nothing was changed, the details are in the API log";

    // The folder a backup lives in, or null when the id isn't one
    public string? FolderOf(string id)
    {
        if (!ValidId(id)) return null;
        var full = Path.GetFullPath(Path.Combine(_folder, id));
        return TryRead(full, out _) ? full : null;
    }

    public BackupEntry? Find(string id)
    {
        var dir = FolderOf(id);
        return dir is not null && TryRead(dir, out var entry) ? entry : null;
    }

    // Removes one backup folder. The newest copy stays so there is always something to restore from.
    public void Delete(string id)
    {
        if (Running) throw new BackupBusyException();
        var dir = FolderOf(id) ?? throw new BackupUploadException("No backup has that id. Nothing was changed", StatusCodes.Status404NotFound);
        var all = List();
        if (all.Count <= 1)
        {
            throw new BackupUploadException("This is the only backup left, so it was kept. Make a new backup before you delete it", StatusCodes.Status409Conflict);
        }
        DeleteFolder(dir);
        log.LogInformation("Backup {Id} deleted", id);
    }

    public bool Running
    {
        get { lock (_statusLock) return _running; }
    }

    // Null when nothing changed since the newest backup, so there was nothing new to save. A before-restore copy is always made.
    public async Task<BackupEntry?> RunAsync(string kind, string by, CancellationToken ct)
    {
        if (!await _gate.WaitAsync(0, ct))
        {
            throw new BackupBusyException();
        }

        _running = true;
        string? dir = null;
        try
        {
            var tool = ResolveTool();
            Directory.CreateDirectory(_folder);
            // Ids go down to the second. Two runs in the same second would share a folder, and a failed one
            // would delete the good one with it, so wait for a free name.
            string id;
            while (true)
            {
                id = $"{DateTime.Now.ToString("yyyy-MM-dd_HHmmss", CultureInfo.InvariantCulture)}_{kind}";
                if (!Directory.Exists(Path.Combine(_folder, id))) break;
                await Task.Delay(250, ct);
            }
            dir = Path.Combine(_folder, id);
            Directory.CreateDirectory(dir);

            var mainFile = Path.Combine(dir, "main.dump");
            var collectorFile = Path.Combine(dir, "collector.dump");
            var main = new NpgsqlConnectionStringBuilder(connections.Main);
            var collector = new NpgsqlConnectionStringBuilder(connections.Collector);
            var rowCount = 0;

            // The dump and the Excel file read the same snapshot, so they match even if someone edits a row meanwhile
            string fingerprint;
            bool unchanged;
            await using (var conn = new NpgsqlConnection(connections.Main))
            {
                await conn.OpenAsync(ct);
                await using var tx = await conn.BeginTransactionAsync(System.Data.IsolationLevel.RepeatableRead, ct);
                await using var snap = new NpgsqlCommand("SELECT pg_export_snapshot()", conn, tx);
                var snapshot = (string)(await snap.ExecuteScalarAsync(ct))!;

                // Checked on the same snapshot the dump would read, so the answer matches what would be saved
                fingerprint = await FingerprintAsync(conn, tx, ct);
                unchanged = kind != "before-restore" && fingerprint == LastFingerprint();
                if (!unchanged)
                {
                    await DumpAsync(tool, main, mainFile, "main", ct, snapshot, DumpedTables);
                    rowCount = await WriteExcelAsync(conn, tx, Path.Combine(dir, ExcelFile), ct);
                }
            }
            if (unchanged)
            {
                DeleteFolder(dir);
                dir = null;
                return null;
            }
            await DumpAsync(tool, collector, collectorFile, "history", ct);

            // The sizes are of the dumps themselves, before they are sealed
            var mainSize = new FileInfo(mainFile).Length;
            var collectorSize = new FileInfo(collectorFile).Length;

            // Sealed before anything else reads them, so the copies only open on this computer. The signature below covers the sealed files.
            var sealKey = signer.SealKey;
            foreach (var file in new[] { mainFile, collectorFile, Path.Combine(dir, ExcelFile) })
            {
                await BackupCipher.SealFileAsync(file, sealKey, ct);
            }

            var createdAt = DateTimeOffset.UtcNow;
            var migrations = status.AppliedMigrations.ToList();
            var entry = new BackupEntry(
                id,
                createdAt,
                kind,
                by,
                mainSize,
                collectorSize,
                rules.Current.Version,
                HasExcel: true,
                RowCount: rowCount,
                Migrations: migrations);

            var json = JsonSerializer.Serialize(new
            {
                createdAt,
                kind,
                by,
                mainSize = entry.MainSize,
                collectorSize = entry.CollectorSize,
                migrations,
                rulesVersion = entry.RulesVersion,
                rowCount,
                fingerprint
            }, JsonOptions);
            await File.WriteAllTextAsync(Path.Combine(dir, "backup.json"), json, ct);
            // Signed last, over every file, so this backup can be downloaded and dropped back in later
            await signer.SignAsync(dir, ct);

            lock (_statusLock)
            {
                _lastError = null;
                _lastErrorAt = null;
            }

            dir = null;
            try
            {
                Prune();
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // The copy is already saved. A failed cleanup waits for the next run.
                log.LogError(ex, "Backup prune failed");
            }

            return entry;
        }
        catch (Exception ex)
        {
            if (dir is not null)
            {
                DeleteFolder(dir);
            }
            if (ex is not OperationCanceledException)
            {
                lock (_statusLock)
                {
                    _lastError = PlainMessage(ex);
                    _lastErrorAt = DateTimeOffset.UtcNow;
                }
            }
            throw;
        }
        finally
        {
            _running = false;
            _gate.Release();
        }
    }

    public IReadOnlyList<BackupEntry> List()
    {
        if (!Directory.Exists(_folder))
        {
            return [];
        }

        var found = new List<BackupEntry>();
        foreach (var dir in Directory.GetDirectories(_folder))
        {
            // A folder starting with a dot is an upload still being checked
            if (Path.GetFileName(dir).StartsWith('.')) continue;
            if (TryRead(dir, out var entry))
            {
                found.Add(entry);
            }
        }
        return found.OrderByDescending(e => e.CreatedAt).ThenByDescending(e => e.Id).ToList();
    }

    public object Status()
    {
        lock (_statusLock)
        {
            return new
            {
                running = _running,
                lastError = _lastError,
                lastErrorAt = _lastErrorAt,
                nextNightly = NextNightly(),
                keepDays = _keepDays,
                folder = _folder
            };
        }
    }

    // Deletes copies older than KeepDays. The newest successful copy always stays,
    // and a folder with no readable backup.json is left alone.
    public void Prune()
    {
        PruneDirectory(_folder, _keepDays, DateTimeOffset.UtcNow);
        SweepLeftovers();
    }

    public static void PruneDirectory(string folder, int keepDays, DateTimeOffset now)
    {
        if (!Directory.Exists(folder))
        {
            return;
        }

        var readable = new List<(string Path, DateTimeOffset CreatedAt)>();
        foreach (var dir in Directory.GetDirectories(folder))
        {
            if (Path.GetFileName(dir).StartsWith('.') || !TryRead(dir, out var entry))
            {
                continue;
            }
            // An uploaded backup counts from the day it was dropped in, so an old one isn't removed straight away
            readable.Add((dir, entry.UploadedAt ?? entry.CreatedAt));
        }
        if (readable.Count == 0)
        {
            return;
        }

        var newest = readable
            .OrderByDescending(item => item.CreatedAt)
            .ThenByDescending(item => item.Path, StringComparer.OrdinalIgnoreCase)
            .First();
        var cutoff = now.AddDays(-keepDays);
        foreach (var item in readable)
        {
            if (string.Equals(item.Path, newest.Path, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }
            if (item.CreatedAt < cutoff)
            {
                DeleteFolder(item.Path);
            }
        }
    }

    // Backups from before sealing get sealed here, once. Only a backup that checks out, or one that was never signed,
    // is touched. A folder whose files are already sealed is skipped. Runs when the API starts, before any backup.
    public async Task SealExistingAsync(CancellationToken ct)
    {
        await _gate.WaitAsync(ct);
        try
        {
            if (!Directory.Exists(_folder)) return;
            // Nothing runs at startup, so a plain copy left by a restore that crashed is safe to remove now
            foreach (var file in Directory.GetFiles(_folder, PlainPrefix + "*")) TryDeleteFile(file);

            byte[] key;
            try
            {
                key = signer.SealKey;
            }
            catch (BackupFailedException ex)
            {
                log.LogError("Old backups stay unsealed until the backup key is usable: {Message}", ex.Message);
                return;
            }

            foreach (var dir in Directory.GetDirectories(_folder))
            {
                if (Path.GetFileName(dir).StartsWith('.') || !TryRead(dir, out _)) continue;
                try
                {
                    var signed = File.Exists(Path.Combine(dir, BackupSigner.SignatureFile));
                    if (signed && await signer.MacOfAsync(dir, ct) is null)
                    {
                        log.LogWarning("Left backup {Id} as it is, its files don't match its signature", Path.GetFileName(dir));
                        continue;
                    }

                    var changed = false;
                    foreach (var name in BackupSigner.Sealed)
                    {
                        var path = Path.Combine(dir, name);
                        if (!File.Exists(path) || await BackupCipher.IsSealedAsync(path, ct)) continue;
                        await BackupCipher.SealFileAsync(path, key, ct);
                        changed = true;
                    }
                    if (changed && signed) await signer.SignAsync(dir, ct);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    log.LogError(ex, "Couldn't seal backup {Id}, it's left as it is", Path.GetFileName(dir));
                }
            }
        }
        finally
        {
            _gate.Release();
        }
    }

    // Full path of a dump, or null when the path would leave the backup folder.
    public string? ResolveDump(string id, string file)
    {
        var name = file switch
        {
            "main" => "main.dump",
            "collector" => "collector.dump",
            "excel" => ExcelFile,
            _ => null
        };
        if (name is null)
        {
            return null;
        }

        var root = Path.GetFullPath(_folder);
        var full = Path.GetFullPath(Path.Combine(root, id, name));
        var prefix = root.EndsWith(Path.DirectorySeparatorChar) ? root : root + Path.DirectorySeparatorChar;
        if (!full.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }
        return full;
    }

    private DateTimeOffset NextNightly()
    {
        var local = DateTime.Now;
        var next = local.Date + NightlyTime;
        if (local.TimeOfDay >= NightlyTime)
        {
            next = next.AddDays(1);
        }
        return new DateTimeOffset(next);
    }

    // a. Backup:PgDump, and a missing file is an error. b. PATH. c. Newest installed Postgres. d. docker, only for the Docker database.
    public DatabaseTool ResolveTool()
    {
        if (_pgDumpSetting is not null)
        {
            if (!File.Exists(_pgDumpSetting))
            {
                throw new BackupFailedException(MissingConfiguredToolMessage);
            }
            return DatabaseTool.FromFile(_pgDumpSetting);
        }

        var onPath = FindOnPath();
        if (onPath is not null)
        {
            return DatabaseTool.FromFile(onPath);
        }

        var installed = NewestInstalledDump();
        if (installed is not null)
        {
            return DatabaseTool.FromFile(installed);
        }

        if (UseDockerDump())
        {
            return DatabaseTool.InDocker();
        }

        throw new BackupFailedException(MissingToolMessage);
    }

    // pg_restore sits next to pg_dump, whichever way pg_dump was found
    public DatabaseTool ResolveRestoreTool()
    {
        var dump = ResolveTool();
        if (dump.Docker) return dump;
        var dir = Path.GetDirectoryName(dump.Path!) ?? "";
        var name = Path.GetFileName(dump.Path!).EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? "pg_restore.exe" : "pg_restore";
        var path = Path.Combine(dir, name);
        if (!File.Exists(path)) throw new BackupFailedException(MissingRestoreToolMessage);
        return DatabaseTool.FromFile(path);
    }

    private bool UseDockerDump()
    {
        if (connections.UsingDockerDefault)
        {
            return true;
        }
        var main = new NpgsqlConnectionStringBuilder(connections.Main);
        return main.Port == 5433;
    }

    // label is what the page calls the database, "main" or "history". pg_dump's own words only go to the log.
    private async Task DumpAsync(DatabaseTool tool, NpgsqlConnectionStringBuilder db, string outFile, string label,
        CancellationToken ct, string? snapshot = null, IReadOnlyList<string>? tables = null)
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
            // Copies PGPASSWORD into the container. The value stays in the environment, not on the command line.
            if (!string.IsNullOrEmpty(db.Password))
            {
                psi.ArgumentList.Add("-e");
                psi.ArgumentList.Add("PGPASSWORD");
            }
            psi.ArgumentList.Add("stock-listing-db");
            psi.ArgumentList.Add("pg_dump");
        }

        psi.ArgumentList.Add("-Fc");
        psi.ArgumentList.Add("--no-owner");
        // Only these tables, quoted so pg_dump matches the exact name
        foreach (var table in tables ?? [])
        {
            psi.ArgumentList.Add("-t");
            psi.ArgumentList.Add($"\"{table}\"");
        }
        if (snapshot is not null)
        {
            psi.ArgumentList.Add($"--snapshot={snapshot}");
        }
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
            psi.ArgumentList.Add("-f");
            psi.ArgumentList.Add(outFile);
        }
        if (!string.IsNullOrEmpty(db.Password))
        {
            psi.Environment["PGPASSWORD"] = db.Password;
        }

        using var process = new Process { StartInfo = psi };
        try
        {
            if (!process.Start()) throw new BackupFailedException("The backup program didn't start");
        }
        catch (System.ComponentModel.Win32Exception ex)
        {
            log.LogError(ex, "Couldn't start {Program}", psi.FileName);
            throw new BackupFailedException(MissingToolMessage);
        }
        process.StandardInput.Close();

        var stderrTask = process.StandardError.ReadToEndAsync(ct);
        using var timeout = new CancellationTokenSource();
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, timeout.Token);
        timeout.CancelAfter(TimeSpan.FromMinutes(10));

        try
        {
            if (tool.Docker)
            {
                await using var stream = new FileStream(outFile, FileMode.Create, FileAccess.Write, FileShare.Read);
                // BaseStream, because a text reader would break the custom-format bytes.
                await process.StandardOutput.BaseStream.CopyToAsync(stream, linked.Token);
            }
            else
            {
                await process.StandardOutput.BaseStream.CopyToAsync(Stream.Null, linked.Token);
            }
            await process.WaitForExitAsync(linked.Token);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            Kill(process);
            log.LogError("pg_dump of {Database} timed out: {Detail}", db.Database, LastNonEmptyLine(await ReadQuiet(stderrTask)));
            throw new BackupFailedException($"Copying the {label} database took too long and was stopped");
        }

        var stderr = await ReadQuiet(stderrTask);
        if (process.ExitCode != 0)
        {
            log.LogError("pg_dump of {Database} failed with code {Code}: {Detail}", db.Database, process.ExitCode, LastNonEmptyLine(stderr));
            throw new BackupFailedException($"The {label} database couldn't be copied. The details are in the API log");
        }
    }

    // A fingerprint of what a backup keeps. Equal fingerprints mean the same data, so the second copy adds nothing.
    // Users' last sign in is left out: signing in is not a change worth a backup.
    private static async Task<string> FingerprintAsync(NpgsqlConnection conn, NpgsqlTransaction tx, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand("""
            SELECT md5(coalesce(string_agg(x, chr(10) ORDER BY x), ''))
            FROM (
                SELECT 'Industries|' || t::text AS x FROM "Industries" t
                UNION ALL SELECT 'RuleVersions|' || t::text FROM "RuleVersions" t
                UNION ALL SELECT 'UserTables|' || t::text FROM "UserTables" t
                UNION ALL SELECT 'UserTableRows|' || t::text FROM "UserTableRows" t
                UNION ALL SELECT 'Users|' || (to_jsonb(t) - 'LastLoginAt')::text FROM "Users" t
                UNION ALL SELECT 'UserAvatars|' || t::text FROM "UserAvatars" t
            ) s
            """, conn, tx);
        return (string)(await cmd.ExecuteScalarAsync(ct))!;
    }

    // The fingerprint of the newest backup, or null when there is none or it predates fingerprints
    private string? LastFingerprint()
    {
        foreach (var dir in Directory.GetDirectories(_folder).OrderByDescending(Path.GetFileName, StringComparer.Ordinal))
        {
            if (Path.GetFileName(dir).StartsWith('.') || !TryRead(dir, out _)) continue;
            try
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(dir, "backup.json")));
                return doc.RootElement.TryGetProperty("fingerprint", out var value) ? value.GetString() : null;
            }
            catch (Exception ex) when (ex is IOException or JsonException)
            {
                return null;
            }
        }
        return null;
    }

    // The table as Excel opens it: the same columns the page export has, custom fields included. Returns how many rows it wrote.
    private async Task<int> WriteExcelAsync(NpgsqlConnection conn, NpgsqlTransaction tx, string file, CancellationToken ct)
    {
        var count = 0;
        var custom = rules.Current.Fields.Where(f => f.Custom && !f.Hidden).ToList();
        var csv = new System.Text.StringBuilder();
        csv.AppendLine(string.Join(",", new[] { "ID", "Name", "Sector", "Price", "Release" }
            .Concat(custom.Select(f => f.Label)).Select(CsvText.Cell)));

        await using var cmd = new NpgsqlCommand(
            """SELECT "Id", "Name", "Sector", "Price", "Release", "Extra" FROM "Industries" ORDER BY "Id" """, conn, tx);
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            count++;
            JsonElement? extra = reader.IsDBNull(5) ? null : JsonSerializer.Deserialize<JsonElement>(reader.GetString(5));
            var cells = new List<string>
            {
                reader.GetInt32(0).ToString(CultureInfo.InvariantCulture),
                Text(reader.IsDBNull(1) ? "" : reader.GetString(1)),
                Text(reader.IsDBNull(2) ? "" : reader.GetString(2)),
                reader.IsDBNull(3) ? "" : reader.GetDecimal(3).ToString(CultureInfo.InvariantCulture),
                reader.IsDBNull(4) ? "" : reader.GetFieldValue<DateOnly>(4).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
            };
            foreach (var field in custom)
            {
                var cell = "";
                if (extra is { ValueKind: JsonValueKind.Object } e && e.TryGetProperty(field.Key, out var v))
                {
                    cell = v.ValueKind switch
                    {
                        JsonValueKind.String => v.GetString()!,
                        JsonValueKind.Null => "",
                        _ => v.GetRawText()
                    };
                }
                cells.Add(Text(cell));
            }
            csv.AppendLine(string.Join(",", cells));
        }

        // The BOM makes Excel read it as UTF-8, so Arabic and accented names come through
        await File.WriteAllTextAsync(file, csv.ToString(), new System.Text.UTF8Encoding(true), ct);
        return count;

        static string Text(string value) => CsvText.Cell(CsvText.GuardFormula(value));
    }

    private static bool TryRead(string dir, out BackupEntry entry)
    {
        entry = null!;
        var path = Path.Combine(dir, "backup.json");
        if (!File.Exists(path))
        {
            return false;
        }

        try
        {
            var doc = JsonSerializer.Deserialize<BackupJson>(File.ReadAllText(path), JsonOptions);
            if (doc?.CreatedAt is not DateTimeOffset createdAt)
            {
                return false;
            }
            var uploaded = ReadUploaded(dir);
            entry = new BackupEntry(
                Path.GetFileName(dir),
                createdAt,
                uploaded is null ? doc.Kind ?? "" : "uploaded",
                doc.By ?? "",
                doc.MainSize,
                doc.CollectorSize,
                doc.RulesVersion,
                File.Exists(Path.Combine(dir, ExcelFile)),
                doc.RowCount,
                doc.Migrations,
                uploaded?.UploadedAt,
                File.Exists(Path.Combine(dir, BackupSigner.SignatureFile)));
            return true;
        }
        catch (Exception ex) when (ex is JsonException or IOException)
        {
            return false;
        }
    }

    private static string? FindOnPath()
    {
        var path = Environment.GetEnvironmentVariable("PATH");
        if (string.IsNullOrEmpty(path))
        {
            return null;
        }
        foreach (var dir in path.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
        {
            foreach (var name in new[] { "pg_dump.exe", "pg_dump" })
            {
                var candidate = Path.Combine(dir.Trim(), name);
                if (File.Exists(candidate))
                {
                    return candidate;
                }
            }
        }
        return null;
    }

    private static string? NewestInstalledDump()
    {
        var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "PostgreSQL");
        if (!Directory.Exists(root))
        {
            return null;
        }

        string? bestPath = null;
        Version? best = null;
        foreach (var dir in Directory.GetDirectories(root))
        {
            var name = Path.GetFileName(dir);
            if (!Version.TryParse(name.Contains('.') ? name : name + ".0", out var version))
            {
                continue;
            }
            var exe = Path.Combine(dir, "bin", "pg_dump.exe");
            if (!File.Exists(exe))
            {
                continue;
            }
            if (best is null || version > best)
            {
                best = version;
                bestPath = exe;
            }
        }
        return bestPath;
    }

    private static void Kill(Process process)
    {
        try
        {
            if (!process.HasExited)
            {
                process.Kill(entireProcessTree: true);
            }
        }
        catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception)
        {
        }
    }

    private static async Task<string> ReadQuiet(Task<string> stderrTask)
    {
        try
        {
            return await stderrTask;
        }
        catch (Exception ex) when (ex is OperationCanceledException or IOException)
        {
            return "";
        }
    }

    private static string LastNonEmptyLine(string text)
    {
        var lines = text.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return lines.Length == 0 ? "" : lines[^1];
    }

    // ---- moving a backup as one file ----

    // Where an upload is written while it arrives: a dot file beside the backups, on the same disk
    public string NewUploadPath()
    {
        Directory.CreateDirectory(_folder);
        return Path.Combine(_folder, $".upload-{Guid.NewGuid():N}.zip");
    }

    // Downloads, uploads and checks that a crash left behind, a day after the fact
    private void SweepLeftovers()
    {
        if (!Directory.Exists(_folder)) return;
        var cutoff = DateTime.UtcNow.AddDays(-1);
        foreach (var file in Directory.GetFiles(_folder, ".*.zip"))
        {
            if (File.GetLastWriteTimeUtc(file) < cutoff) TryDeleteFile(file);
        }
        // A plain copy left by a restore that crashed. A restore may be running right now, so only old ones go here.
        foreach (var file in Directory.GetFiles(_folder, PlainPrefix + "*"))
        {
            if (File.GetLastWriteTimeUtc(file) < cutoff) TryDeleteFile(file);
        }
        foreach (var dir in Directory.GetDirectories(_folder, ".*"))
        {
            if (Directory.GetLastWriteTimeUtc(dir) < cutoff) DeleteFolder(dir);
        }
    }

    private static void TryDeleteFile(string path)
    {
        try
        {
            File.Delete(path);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // Still open somewhere, the next sweep takes it
        }
    }

    // The contents of a backup file, read in plain as it streams out. A file from before sealing is read as it is.
    public async Task<Stream> OpenFileAsync(string path, CancellationToken ct)
    {
        if (!await BackupCipher.IsSealedAsync(path, ct))
        {
            return new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        }
        return await BackupCipher.OpenReadAsync(path, signer.SealKey, ct);
    }

    // A plain copy of a backup file in the backups folder, for pg_restore, which only reads a path. The caller deletes it.
    public async Task<string> DecryptToTempAsync(string path, CancellationToken ct)
    {
        Directory.CreateDirectory(_folder);
        var temp = Path.Combine(_folder, $"{PlainPrefix}{Guid.NewGuid():N}");
        try
        {
            await using var input = await OpenFileAsync(path, ct);
            await using var output = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None);
            await input.CopyToAsync(output, ct);
        }
        catch (System.Security.Cryptography.CryptographicException ex)
        {
            TryDeleteFile(temp);
            log.LogError(ex, "Couldn't open backup file {Path}", path);
            throw new BackupFailedException(BackupCipher.CantOpenMessage + ". Nothing was changed");
        }
        catch
        {
            TryDeleteFile(temp);
            throw;
        }
        return temp;
    }

    public static void DeletePlainCopy(string path) => TryDeleteFile(path);

    // The backup's files in one zip, written beside the backups (a dot file, so no listing picks it up). The caller
    // serves it and deletes it. uploaded.json stays out, so the zip carries exactly what was signed.
    public string? ZipOf(string id)
    {
        var dir = FolderOf(id);
        if (dir is null) return null;
        var zipPath = Path.Combine(_folder, $".download-{Guid.NewGuid():N}.zip");
        using (var zip = ZipFile.Open(zipPath, ZipArchiveMode.Create))
        {
            foreach (var name in BackupSigner.Files.Append(BackupSigner.SignatureFile))
            {
                var path = Path.Combine(dir, name);
                // The dumps are compressed already, so the zip only stores them
                if (File.Exists(path)) zip.CreateEntryFromFile(path, name, CompressionLevel.NoCompression);
            }
        }
        return zipPath;
    }

    // A zip someone dropped in. Unpacked into a dot folder, checked, and only then added to the list as an
    // uploaded backup. Restoring it is the same Restore button and checks as any other backup. Nothing in the
    // file reaches pg_restore unless this app's own signature on it is good.
    public async Task<BackupEntry> ImportAsync(string zipPath, string by, long maxBytes, CancellationToken ct)
    {
        Directory.CreateDirectory(_folder);
        var staging = Path.Combine(_folder, "." + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(staging);
        try
        {
            try
            {
                using var zip = ZipFile.OpenRead(zipPath);
                var seen = new HashSet<string>(StringComparer.Ordinal);
                long total = 0;
                foreach (var entry in zip.Entries)
                {
                    // Only the exact file names a backup has: no folders, no paths, nothing twice
                    var allowed = BackupSigner.Files.Contains(entry.FullName) || entry.FullName == BackupSigner.SignatureFile;
                    if (!allowed || !seen.Add(entry.FullName)) throw NotOurs();
                    if (entry.Length > maxBytes) throw TooBig(maxBytes);

                    await using var source = entry.Open();
                    await using var target = new FileStream(Path.Combine(staging, entry.FullName), FileMode.CreateNew, FileAccess.Write);
                    var buffer = new byte[81920];
                    int read;
                    // Counted while unpacking, since the sizes a zip claims can't be trusted
                    while ((read = await source.ReadAsync(buffer, ct)) > 0)
                    {
                        total += read;
                        if (total > maxBytes) throw TooBig(maxBytes);
                        await target.WriteAsync(buffer.AsMemory(0, read), ct);
                    }
                }
            }
            catch (InvalidDataException)
            {
                if (await IsPgDumpAsync(zipPath, ct)) throw DumpRefused();
                throw NotOurs();
            }

            // Each device has its own data and migrations, so a backup from another device is refused, and so is one from before signing
            if (!File.Exists(Path.Combine(staging, BackupSigner.SignatureFile)))
            {
                throw new BackupUploadException("This backup was made before backups were signed, so it can't be added from a file. " +
                    "It can only be restored from its place in the list on the device that made it. Nothing was changed", StatusCodes.Status400BadRequest);
            }
            var mac = await signer.MacOfAsync(staging, ct)
                ?? throw new BackupUploadException("This backup was made on another device, or it was changed after it was made. " +
                    "Backups only work on the device that made them. Nothing was changed", StatusCodes.Status400BadRequest);
            if (!TryRead(staging, out _)) throw NotOurs();

            foreach (var existing in Directory.GetDirectories(_folder))
            {
                if (Path.GetFileName(existing).StartsWith('.')) continue;
                if (BackupSigner.StoredMac(existing) == mac)
                {
                    var existingId = Path.GetFileName(existing);
                    throw new BackupUploadException($"This backup is already in the list, as {existingId}. Nothing was added",
                        StatusCodes.Status409Conflict) { ExistingId = existingId };
                }
            }

            var uploadedAt = DateTimeOffset.UtcNow;
            await File.WriteAllTextAsync(Path.Combine(staging, UploadedFile),
                JsonSerializer.Serialize(new UploadedJson { UploadedAt = uploadedAt, By = by }, JsonOptions), ct);

            string id;
            while (true)
            {
                id = $"{DateTime.Now.ToString("yyyy-MM-dd_HHmmss", CultureInfo.InvariantCulture)}_uploaded";
                if (!Directory.Exists(Path.Combine(_folder, id))) break;
                await Task.Delay(250, ct);
            }
            Directory.Move(staging, Path.Combine(_folder, id));
            log.LogInformation("Backup file uploaded by {By} added as {Id}", by, id);
            return Find(id)!;
        }
        finally
        {
            DeleteFolder(staging);
        }
    }

    private const string UploadedFile = "uploaded.json";

    private static UploadedJson? ReadUploaded(string dir)
    {
        var path = Path.Combine(dir, UploadedFile);
        if (!File.Exists(path)) return null;
        try
        {
            return JsonSerializer.Deserialize<UploadedJson>(File.ReadAllText(path), JsonOptions);
        }
        catch (Exception ex) when (ex is JsonException or IOException)
        {
            return null;
        }
    }

    private static BackupUploadException NotOurs() =>
        new("That isn't a backup .zip from this app. Only a backup .zip made on this device can be added. Nothing was changed",
            StatusCodes.Status400BadRequest);

    private static BackupUploadException DumpRefused() =>
        new("A .dump file can't be added. Only a backup .zip made on this device can be, from its Download button. Nothing was changed",
            StatusCodes.Status400BadRequest);

    // A plain pg_dump file starts with PGDMP, a zip never does
    private static async Task<bool> IsPgDumpAsync(string path, CancellationToken ct)
    {
        await using var stream = File.OpenRead(path);
        var head = new byte[5];
        var read = await stream.ReadAsync(head.AsMemory(), ct);
        return read == 5 && Encoding.ASCII.GetString(head) == "PGDMP";
    }

    private static BackupUploadException TooBig(long maxBytes) =>
        new($"That file is bigger than {maxBytes / (1024 * 1024)} MB, so it can't be used. Nothing was changed",
            StatusCodes.Status413PayloadTooLarge);

    private sealed class UploadedJson
    {
        public DateTimeOffset? UploadedAt { get; set; }
        public string? By { get; set; }
    }

    private static void DeleteFolder(string dir)
    {
        for (var attempt = 1; attempt <= 5; attempt++)
        {
            try
            {
                if (Directory.Exists(dir))
                {
                    Directory.Delete(dir, true);
                }
                return;
            }
            catch (IOException) when (attempt < 5)
            {
                Thread.Sleep(200);
            }
            catch (UnauthorizedAccessException) when (attempt < 5)
            {
                Thread.Sleep(200);
            }
            catch (IOException)
            {
            }
            catch (UnauthorizedAccessException)
            {
            }
        }
    }

    private static string ResolveFolder(IConfiguration config, IWebHostEnvironment env)
    {
        var configured = BlankToNull(config["Backup:Folder"]);
        return configured is null
            ? Path.GetFullPath(Path.Combine(env.ContentRootPath, "..", "backups"))
            : Path.GetFullPath(configured);
    }

    private static TimeSpan ReadTime(IConfiguration config)
    {
        var text = BlankToNull(config["Backup:Time"]);
        if (text is not null && TimeSpan.TryParseExact(text, [@"hh\:mm", @"h\:mm"], CultureInfo.InvariantCulture, out var time))
        {
            return time;
        }
        return new TimeSpan(2, 0, 0);
    }

    private static int ReadKeepDays(IConfiguration config)
    {
        var text = BlankToNull(config["Backup:KeepDays"]);
        return text is not null && int.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out var days) && days >= 1
            ? days
            : 14;
    }

    private static string? BlankToNull(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private sealed class BackupJson
    {
        public DateTimeOffset? CreatedAt { get; set; }
        public string? Kind { get; set; }
        public string? By { get; set; }
        public long MainSize { get; set; }
        public long CollectorSize { get; set; }
        public int RulesVersion { get; set; }
        public int? RowCount { get; set; }
        public List<string>? Migrations { get; set; }
    }
}
