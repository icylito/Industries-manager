using System.Text.Json;
using Npgsql;
using NpgsqlTypes;
using api_v2.Infrastructure.Configuration;
using api_v2.Application.Settings;
using api_v2.Application.Health;
using api_v2.Domain.Rules;
using api_v2.Application.Ports;
using api_v2.Domain.Collector;

namespace api_v2.Infrastructure.Persistence;

// Damaged means a saved value in the collector couldn't be read (edited by hand, or a format that changed).
// The version still shows in the list but can't be restored or imported.
public record VersionSummary(long Id, DateTimeOffset CreatedAt, string Reason, string CreatedBy, int RowCount,
    int? RulesVersion, bool Pinned, List<string> Migrations, bool Damaged = false);

public enum VersionRemoval { Removed, NotFound, Pinned }

// One saved version with everything in it, what View, Download, Restore and Import read
public record VersionDetail(VersionSummary Summary, List<VersionColumn> Columns, string? Rules, List<JsonElement> Rows);

public record VersionColumn(string Name, string Type, bool Nullable);

// Everything that goes into the collector database. The only thing that deletes is retention,
// which the team sets on the History page, and it never touches pinned versions.
//
// versions      one row per full copy, taken before the structure or the rules change
// version_rows  the rows of that copy, each one as JSON so old structures stay readable
// row_changes   a small log of every add, edit and delete, before and after
public class CollectorStore(DatabaseConnections connections, SettingsService settings, DatabaseStatus status, ILogger<CollectorStore> log) : ICollectorStore
{
    private const string Table = "Industries";

    // The longest a saved version's reason is kept. A reason is a few words, or for a database update a list of
    // migration names. The restore note is held to a much shorter limit at the door (HistoryEndpoints.NoteMax), this
    // is the backstop so no caller can ever put a huge text in a list every History visit has to carry.
    public const int ReasonMax = 1000;

    // The reason cut to ReasonMax, with an ellipsis, never through the middle of a character
    public static string Clip(string reason)
    {
        if (reason.Length <= ReasonMax) return reason;
        var cut = ReasonMax - 1;
        if (char.IsHighSurrogate(reason[cut - 1])) cut--;
        return reason[..cut] + "…";
    }

    public const string UnreachableMessage = "The history database (collector) isn't reachable";

    // Looks at a failure from any collector call. A connection, database or password problem means history is down,
    // and the badge should say so right away instead of waiting for the next check. Returns true when it was one of those.
    public bool NoteFailure(Exception ex)
    {
        for (var current = ex; current is not null; current = current.InnerException)
        {
            var down = current switch
            {
                PostgresException pg => pg.SqlState is PostgresErrorCodes.InvalidCatalogName or PostgresErrorCodes.UndefinedTable
                    or PostgresErrorCodes.AdminShutdown or PostgresErrorCodes.CrashShutdown or PostgresErrorCodes.CannotConnectNow
                    or PostgresErrorCodes.InvalidPassword or PostgresErrorCodes.InvalidAuthorizationSpecification
                    or PostgresErrorCodes.TooManyConnections,
                NpgsqlException => true,
                System.Net.Sockets.SocketException or IOException or TimeoutException => true,
                _ => false
            };
            if (!down) continue;
            if (status.HistoryWasReady && status.HistoryReady) status.SetHistory(false, UnreachableMessage);
            return true;
        }
        return false;
    }

    // A quick look at the collector, true when it answers and its tables are there
    public async Task<bool> PingAsync(CancellationToken ct)
    {
        try
        {
            await using var conn = new NpgsqlConnection(connections.Collector);
            await conn.OpenAsync(ct);
            await using var cmd = new NpgsqlCommand("SELECT 1 FROM versions LIMIT 1", conn) { CommandTimeout = 10 };
            await cmd.ExecuteScalarAsync(ct);
            return true;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return false;
        }
    }

    public async Task EnsureSchemaAsync(CancellationToken ct)
    {
        await using var conn = await OpenAsync(connections.Collector, ct);
        await using var cmd = new NpgsqlCommand($$"""
            CREATE TABLE IF NOT EXISTS versions (
                id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                created_at   timestamptz NOT NULL DEFAULT now(),
                reason       text NOT NULL,
                created_by   text NOT NULL,
                source_table text NOT NULL,
                migrations   jsonb NOT NULL,
                rules_version int,
                rules        jsonb,
                columns      jsonb NOT NULL,
                row_count    int NOT NULL,
                pinned       boolean NOT NULL DEFAULT false
            );
            CREATE TABLE IF NOT EXISTS version_rows (
                version_id bigint NOT NULL REFERENCES versions(id),
                row_id     int,
                data       jsonb NOT NULL
            );
            CREATE INDEX IF NOT EXISTS ix_version_rows_version ON version_rows (version_id);
            CREATE TABLE IF NOT EXISTS row_changes (
                id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                at            timestamptz NOT NULL DEFAULT now(),
                source_table  text NOT NULL,
                row_id        int,
                action        text NOT NULL,
                before        jsonb,
                after         jsonb,
                rules_version int,
                changed_by    text NOT NULL,
                status        text NOT NULL
            );
            -- A reason can't be made huge again. NOT VALID checks new rows only, so a version saved before this
            -- limit existed is left exactly as it was and never stops the history database from starting.
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'versions_reason_length') THEN
                    ALTER TABLE versions ADD CONSTRAINT versions_reason_length CHECK (char_length(reason) <= {{ReasonMax}}) NOT VALID;
                END IF;
            END $$;
            """, conn);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    // Copies the whole table into the collector. Returns null when there's no table yet (fresh database).
    // The copy is one transaction, so a version is either complete or not there at all.
    // applyRetention false is for restore and import, they clean up once the change went through (and keep the version they used)
    public async Task<long?> SaveVersionAsync(string reason, string createdBy, CancellationToken ct = default, bool applyRetention = true)
    {
        await using var main = await OpenAsync(connections.Main, ct);
        if (!await TableExistsAsync(main, Table, ct))
        {
            return null;
        }

        var migrations = await TableExistsAsync(main, "__EFMigrationsHistory", ct)
            ? await ScalarAsync(main, """SELECT coalesce(json_agg("MigrationId" ORDER BY "MigrationId"), '[]')::text FROM "__EFMigrationsHistory" """, ct)
            : "[]";

        int? rulesVersion = null;
        string? rules = null;
        if (await TableExistsAsync(main, "RuleVersions", ct))
        {
            await using var cmd = new NpgsqlCommand("""SELECT "Id", "Fields"::text FROM "RuleVersions" ORDER BY "Id" DESC LIMIT 1""", main);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            if (await reader.ReadAsync(ct))
            {
                rulesVersion = reader.GetInt32(0);
                rules = reader.GetString(1);
            }
        }

        var columns = await ScalarAsync(main, $"""
            SELECT coalesce(json_agg(json_build_object('name', column_name, 'type', data_type, 'nullable', is_nullable = 'YES')
                   ORDER BY ordinal_position), '[]')::text
            FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '{Table}'
            """, ct);

        var rows = new List<(int Id, string Json)>();
        await using (var cmd = new NpgsqlCommand($"""SELECT "Id", row_to_json(t)::text FROM "{Table}" t ORDER BY "Id" """, main))
        await using (var reader = await cmd.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct))
            {
                rows.Add((reader.GetInt32(0), reader.GetString(1)));
            }
        }

        await using var collector = await OpenAsync(connections.Collector, ct);
        await using var tx = await collector.BeginTransactionAsync(ct);

        long versionId;
        await using (var insert = new NpgsqlCommand("""
            INSERT INTO versions (reason, created_by, source_table, migrations, rules_version, rules, columns, row_count)
            VALUES (@reason, @by, @table, @migrations::jsonb, @rulesVersion, @rules::jsonb, @columns::jsonb, @count)
            RETURNING id
            """, collector, tx))
        {
            insert.Parameters.AddWithValue("reason", Clip(reason));
            insert.Parameters.AddWithValue("by", createdBy);
            insert.Parameters.AddWithValue("table", Table);
            insert.Parameters.AddWithValue("migrations", migrations);
            insert.Parameters.AddWithValue("rulesVersion", (object?)rulesVersion ?? DBNull.Value);
            insert.Parameters.AddWithValue("rules", (object?)rules ?? DBNull.Value);
            insert.Parameters.AddWithValue("columns", columns);
            insert.Parameters.AddWithValue("count", rows.Count);
            versionId = (long)(await insert.ExecuteScalarAsync(ct))!;
        }

        await using (var copy = await collector.BeginBinaryImportAsync(
            "COPY version_rows (version_id, row_id, data) FROM STDIN (FORMAT BINARY)", ct))
        {
            foreach (var (id, json) in rows)
            {
                await copy.StartRowAsync(ct);
                await copy.WriteAsync(versionId, NpgsqlDbType.Bigint, ct);
                await copy.WriteAsync(id, NpgsqlDbType.Integer, ct);
                await copy.WriteAsync(json, NpgsqlDbType.Jsonb, ct);
            }
            await copy.CompleteAsync(ct);
        }

        await tx.CommitAsync(ct);
        log.LogInformation("Saved version {Version} with {Rows} rows: {Reason}", versionId, rows.Count, Clip(reason));

        if (applyRetention)
        {
            try
            {
                await ApplyRetentionAsync(ct);
            }
            catch (Exception ex)
            {
                // The new version is saved either way, old ones just stay a bit longer
                log.LogWarning(ex, "Retention cleanup failed");
            }
        }
        return versionId;
    }

    // Takes back a copy that was saved for a change that didn't happen. Best effort, a leftover copy is only clutter.
    public async Task DeleteVersionAsync(long id)
    {
        try
        {
            await using var conn = await OpenAsync(connections.Collector, CancellationToken.None);
            await using var tx = await conn.BeginTransactionAsync();
            await using var cmd = new NpgsqlCommand("""
                DELETE FROM version_rows WHERE version_id = @id;
                DELETE FROM versions WHERE id = @id AND NOT pinned;
                """, conn, tx);
            cmd.Parameters.AddWithValue("id", id);
            await cmd.ExecuteNonQueryAsync();
            await tx.CommitAsync();
        }
        catch (Exception ex)
        {
            log.LogWarning(ex, "Couldn't remove the unused copy {Version}", id);
        }
    }

    // Someone pressed Delete on a saved version. A pinned one stays, it has to be unpinned first. The row is locked before
    // anything goes, so a pin landing at the same moment either wins (nothing deleted) or waits and finds it gone.
    public async Task<VersionRemoval> RemoveVersionAsync(long id, CancellationToken ct = default)
    {
        await using var conn = await OpenAsync(connections.Collector, ct);
        await using var tx = await conn.BeginTransactionAsync(ct);
        bool pinned;
        await using (var find = new NpgsqlCommand("SELECT pinned FROM versions WHERE id = @id FOR UPDATE", conn, tx))
        {
            find.Parameters.AddWithValue("id", id);
            var found = await find.ExecuteScalarAsync(ct);
            if (found is null) return VersionRemoval.NotFound;
            pinned = (bool)found;
        }
        if (pinned) return VersionRemoval.Pinned;
        await using var delete = new NpgsqlCommand("""
            DELETE FROM version_rows WHERE version_id = @id;
            DELETE FROM versions WHERE id = @id;
            """, conn, tx);
        delete.Parameters.AddWithValue("id", id);
        await delete.ExecuteNonQueryAsync(ct);
        await tx.CommitAsync(ct);
        return VersionRemoval.Removed;
    }

    // Retention after a restore or import, the version the rows came from always stays
    public async Task ApplyRetentionQuietlyAsync(long? keepVersionId, CancellationToken ct)
    {
        try
        {
            await ApplyRetentionAsync(ct, keepVersionId);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "Retention cleanup failed");
        }
    }

    // Edits and deletes log first as "pending", then get marked "done" or "failed" once the change ran.
    // If this throws, the caller doesn't make the change, so nothing is lost without a copy.
    public async Task<long> LogChangeAsync(int? rowId, string action, object? before, object? after,
        int? rulesVersion, string changedBy, string status = "pending", CancellationToken ct = default)
    {
        await using var conn = await OpenAsync(connections.Collector, ct);
        await using var cmd = new NpgsqlCommand("""
            INSERT INTO row_changes (source_table, row_id, action, before, after, rules_version, changed_by, status)
            VALUES (@table, @rowId, @action, @before::jsonb, @after::jsonb, @rulesVersion, @by, @status)
            RETURNING id
            """, conn);
        cmd.Parameters.AddWithValue("table", Table);
        cmd.Parameters.AddWithValue("rowId", (object?)rowId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("action", action);
        cmd.Parameters.AddWithValue("before", before is null ? DBNull.Value : JsonSerializer.Serialize(before));
        cmd.Parameters.AddWithValue("after", after is null ? DBNull.Value : JsonSerializer.Serialize(after));
        cmd.Parameters.AddWithValue("rulesVersion", (object?)rulesVersion ?? DBNull.Value);
        cmd.Parameters.AddWithValue("by", changedBy);
        cmd.Parameters.AddWithValue("status", status);
        return (long)(await cmd.ExecuteScalarAsync(ct))!;
    }

    public async Task FinishChangeAsync(long changeId, bool done, int? rowId = null, object? after = null, CancellationToken ct = default)
    {
        try
        {
            await using var conn = await OpenAsync(connections.Collector, ct);
            await using var cmd = new NpgsqlCommand("""
                UPDATE row_changes
                SET status = @status, row_id = COALESCE(@rowId, row_id), after = COALESCE(@after::jsonb, after)
                WHERE id = @id
                """, conn);
            cmd.Parameters.AddWithValue("status", done ? "done" : "failed");
            cmd.Parameters.Add(new NpgsqlParameter("rowId", NpgsqlDbType.Integer) { Value = (object?)rowId ?? DBNull.Value });
            cmd.Parameters.Add(new NpgsqlParameter("after", NpgsqlDbType.Jsonb)
            {
                Value = after is null ? DBNull.Value : JsonSerializer.Serialize(after)
            });
            cmd.Parameters.AddWithValue("id", changeId);
            await cmd.ExecuteNonQueryAsync(ct);
        }
        catch (Exception ex)
        {
            // The change itself already happened or already failed, the copy is safe either way
            log.LogWarning(ex, "Couldn't mark change {Change} as finished", changeId);
        }
    }

    // Which rows were added or edited by hand lately, read from the change log so the table needs no extra columns.
    // A row added on the page is "new", a row saved from its edit form is "updated". Imports are not counted.
    public async Task<IReadOnlyList<ActivityRow>> RecentActivityAsync(int days, CancellationToken ct)
    {
        var found = new List<ActivityRow>();
        await using var conn = await OpenAsync(connections.Collector, ct);
        await using var cmd = new NpgsqlCommand("""
            SELECT row_id,
                   max(at) FILTER (WHERE action = 'add'),
                   max(at) FILTER (WHERE action = 'edit')
            FROM row_changes
            WHERE source_table = @table AND status = 'done' AND row_id IS NOT NULL
              AND action IN ('add', 'edit') AND at > now() - make_interval(days => @days)
            GROUP BY row_id
            """, conn);
        cmd.Parameters.AddWithValue("table", Table);
        cmd.Parameters.AddWithValue("days", days);
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            found.Add(new ActivityRow(reader.GetInt32(0),
                reader.IsDBNull(1) ? null : reader.GetFieldValue<DateTimeOffset>(1),
                reader.IsDBNull(2) ? null : reader.GetFieldValue<DateTimeOffset>(2)));
        }
        return found;
    }

    // Import adds many rows at once, they get logged in one go after the import went through
    public async Task LogImportsAsync(IEnumerable<(int RowId, object After)> rows, int rulesVersion, string changedBy, CancellationToken ct = default)
    {
        await using var conn = await OpenAsync(connections.Collector, ct);
        await using var copy = await conn.BeginBinaryImportAsync(
            "COPY row_changes (source_table, row_id, action, after, rules_version, changed_by, status) FROM STDIN (FORMAT BINARY)", ct);
        foreach (var (rowId, after) in rows)
        {
            await copy.StartRowAsync(ct);
            await copy.WriteAsync(Table, NpgsqlDbType.Text, ct);
            await copy.WriteAsync(rowId, NpgsqlDbType.Integer, ct);
            await copy.WriteAsync("import", NpgsqlDbType.Text, ct);
            await copy.WriteAsync(JsonSerializer.Serialize(after), NpgsqlDbType.Jsonb, ct);
            await copy.WriteAsync(rulesVersion, NpgsqlDbType.Integer, ct);
            await copy.WriteAsync(changedBy, NpgsqlDbType.Text, ct);
            await copy.WriteAsync("done", NpgsqlDbType.Text, ct);
        }
        await copy.CompleteAsync(ct);
    }

    private const string SummaryColumns = "id, created_at, reason, created_by, row_count, rules_version, pinned, migrations::text";

    private static VersionSummary ReadSummary(NpgsqlDataReader reader)
    {
        List<string>? migrations = null;
        try
        {
            migrations = JsonSerializer.Deserialize<List<string>>(reader.GetString(7));
        }
        catch (JsonException)
        {
            // Left null, the version is marked damaged below
        }
        return new VersionSummary(
            reader.GetInt64(0), reader.GetFieldValue<DateTimeOffset>(1), reader.GetString(2), reader.GetString(3),
            reader.GetInt32(4), reader.IsDBNull(5) ? null : reader.GetInt32(5), reader.GetBoolean(6),
            migrations ?? [], Damaged: migrations is null || migrations.Any(m => m is null));
    }

    public async Task<List<VersionSummary>> ListVersionsAsync(CancellationToken ct = default)
    {
        await using var conn = await OpenAsync(connections.Collector, ct);
        await using var cmd = new NpgsqlCommand($"SELECT {SummaryColumns} FROM versions ORDER BY id DESC", conn);
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        var list = new List<VersionSummary>();
        while (await reader.ReadAsync(ct))
        {
            list.Add(ReadSummary(reader));
        }
        return list;
    }

    public async Task<VersionDetail?> GetVersionAsync(long id, CancellationToken ct = default)
    {
        await using var conn = await OpenAsync(connections.Collector, ct);
        VersionSummary summary;
        List<VersionColumn> columns;
        string? rules;
        await using (var cmd = new NpgsqlCommand($"SELECT {SummaryColumns}, columns::text, rules::text FROM versions WHERE id = @id", conn))
        {
            cmd.Parameters.AddWithValue("id", id);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct)) return null;
            summary = ReadSummary(reader);
            try
            {
                var read = JsonSerializer.Deserialize<List<VersionColumn>>(reader.GetString(8), JsonSerializerOptions.Web);
                var bad = read is null || read.Any(c => c is null || c.Name is null);
                columns = bad ? [] : read!;
                if (bad) summary = summary with { Damaged = true };
            }
            catch (JsonException)
            {
                columns = [];
                summary = summary with { Damaged = true };
            }
            rules = reader.IsDBNull(9) ? null : reader.GetString(9);
            // Rules that can't be read count as "no rules saved", rows can still be brought back
            if (rules is not null && !RulesService.TryParseFields(rules, out _)) rules = null;
        }

        var rows = new List<JsonElement>();
        await using (var cmd = new NpgsqlCommand("SELECT data::text FROM version_rows WHERE version_id = @id ORDER BY row_id", conn))
        {
            cmd.Parameters.AddWithValue("id", id);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                var row = JsonDocument.Parse(reader.GetString(0)).RootElement.Clone();
                // A saved row that isn't an object can't be read as a row, it's left out
                if (row.ValueKind == JsonValueKind.Object) rows.Add(row);
                else log.LogWarning("Version {Version} has a saved row that isn't an object, it was left out", id);
            }
        }
        return new VersionDetail(summary, columns, rules, rows);
    }

    public async Task<bool> SetPinnedAsync(long id, bool pinned, CancellationToken ct = default)
    {
        await using var conn = await OpenAsync(connections.Collector, ct);
        await using var cmd = new NpgsqlCommand("UPDATE versions SET pinned = @pinned WHERE id = @id", conn);
        cmd.Parameters.AddWithValue("pinned", pinned);
        cmd.Parameters.AddWithValue("id", id);
        return await cmd.ExecuteNonQueryAsync(ct) > 0;
    }

    // Removes versions past the retention settings, never pinned ones. Returns how many went.
    // keepVersionId is treated like a pinned version for this run (the version a restore or import came from)
    public async Task<int> ApplyRetentionAsync(CancellationToken ct = default, long? keepVersionId = null)
    {
        var (keepVersions, keepDays) = settings.Retention;
        if (keepVersions is null && keepDays is null) return 0;

        await using var conn = await OpenAsync(connections.Collector, ct);
        await using var tx = await conn.BeginTransactionAsync(ct);

        var gone = await FindRemovableAsync(conn, tx, keepVersions, keepDays, keepVersionId, ct);
        if (gone.Count > 0)
        {
            await using var delete = new NpgsqlCommand("""
                DELETE FROM version_rows WHERE version_id = ANY(@ids);
                DELETE FROM versions WHERE id = ANY(@ids);
                """, conn, tx);
            delete.Parameters.AddWithValue("ids", gone.ToArray());
            await delete.ExecuteNonQueryAsync(ct);
            log.LogInformation("Retention removed {Count} old version(s)", gone.Count);
        }
        await tx.CommitAsync(ct);
        return gone.Count;
    }

    // How many versions these settings would remove, nothing gets deleted. The page asks before saving.
    // newCopies is how many copies will be saved first (a rules change saves one), they count toward "keep the last N"
    public async Task<int> CountRemovableAsync(Retention retention, int newCopies = 0, CancellationToken ct = default)
    {
        if (retention.KeepVersions is null && retention.KeepDays is null) return 0;
        await using var conn = await OpenAsync(connections.Collector, ct);
        return (await FindRemovableAsync(conn, null, retention.KeepVersions, retention.KeepDays, null, ct, newCopies)).Count;
    }

    private static async Task<List<long>> FindRemovableAsync(NpgsqlConnection conn, NpgsqlTransaction? tx,
        int? keepVersions, int? keepDays, long? keepVersionId, CancellationToken ct, int newCopies = 0)
    {
        var gone = new List<long>();
        await using var find = new NpgsqlCommand("""
            WITH ranked AS (
                SELECT id, created_at, row_number() OVER (ORDER BY id DESC) AS n
                FROM versions WHERE NOT pinned AND id <> COALESCE(@keepId::bigint, 0)
            )
            SELECT id FROM ranked
            WHERE (@keep::int IS NOT NULL AND n + @extra::int > @keep::int)
               OR (@days::int IS NOT NULL AND created_at < now() - make_interval(days => @days::int))
            """, conn, tx);
        find.Parameters.AddWithValue("keep", (object?)keepVersions ?? DBNull.Value);
        find.Parameters.AddWithValue("days", (object?)keepDays ?? DBNull.Value);
        find.Parameters.AddWithValue("keepId", (object?)keepVersionId ?? DBNull.Value);
        find.Parameters.AddWithValue("extra", newCopies);
        await using var reader = await find.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct)) gone.Add(reader.GetInt64(0));
        return gone;
    }

    // Opening the collector and failing marks history as down right away, so the page's badge doesn't wait for the monitor
    private async Task<NpgsqlConnection> OpenAsync(string connectionString, CancellationToken ct)
    {
        var conn = new NpgsqlConnection(connectionString);
        try
        {
            await conn.OpenAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException && connectionString == connections.Collector)
        {
            // Refused, gone, or a wrong password, history can't be used either way until it answers again
            NoteFailure(ex);
            await conn.DisposeAsync();
            throw;
        }
        catch
        {
            await conn.DisposeAsync();
            throw;
        }
        return conn;
    }

    private static async Task<bool> TableExistsAsync(NpgsqlConnection conn, string table, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand("SELECT to_regclass(@name) IS NOT NULL", conn);
        cmd.Parameters.AddWithValue("name", $"public.\"{table}\"");
        return (bool)(await cmd.ExecuteScalarAsync(ct))!;
    }

    private static async Task<string> ScalarAsync(NpgsqlConnection conn, string sql, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand(sql, conn);
        return (string)(await cmd.ExecuteScalarAsync(ct))!;
    }
}
