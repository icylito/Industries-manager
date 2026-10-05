using System.Text.Json;
using Npgsql;
using NpgsqlTypes;

namespace api_v2.Data;

public record VersionSummary(long Id, DateTimeOffset CreatedAt, string Reason, string CreatedBy, int RowCount,
    int? RulesVersion, bool Pinned);

// Everything that goes into the collector database. Nothing in here deletes, old versions
// only get removed once retention settings exist (History page, step 5).
//
// versions      one row per full copy, taken before the structure or the rules change
// version_rows  the rows of that copy, each one as JSON so old structures stay readable
// row_changes   a small log of every add, edit and delete, before and after
public class CollectorStore(DatabaseConnections connections, ILogger<CollectorStore> log)
{
    private const string Table = "Industries";

    public async Task EnsureSchemaAsync(CancellationToken ct)
    {
        await using var conn = await OpenAsync(connections.Collector, ct);
        await using var cmd = new NpgsqlCommand("""
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
            """, conn);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    // Copies the whole table into the collector. Returns null when there's no table yet (fresh database).
    // The copy is one transaction, so a version is either complete or not there at all.
    public async Task<long?> SaveVersionAsync(string reason, string createdBy, CancellationToken ct = default)
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
            insert.Parameters.AddWithValue("reason", reason);
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
        log.LogInformation("Saved version {Version} with {Rows} rows: {Reason}", versionId, rows.Count, reason);
        return versionId;
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

    public async Task FinishChangeAsync(long changeId, bool done, CancellationToken ct = default)
    {
        try
        {
            await using var conn = await OpenAsync(connections.Collector, ct);
            await using var cmd = new NpgsqlCommand("UPDATE row_changes SET status = @status WHERE id = @id", conn);
            cmd.Parameters.AddWithValue("status", done ? "done" : "failed");
            cmd.Parameters.AddWithValue("id", changeId);
            await cmd.ExecuteNonQueryAsync(ct);
        }
        catch (Exception ex)
        {
            // The change itself already happened or already failed, the copy is safe either way
            log.LogWarning(ex, "Couldn't mark change {Change} as finished", changeId);
        }
    }

    public async Task<List<VersionSummary>> ListVersionsAsync(CancellationToken ct = default)
    {
        await using var conn = await OpenAsync(connections.Collector, ct);
        await using var cmd = new NpgsqlCommand("""
            SELECT id, created_at, reason, created_by, row_count, rules_version, pinned FROM versions ORDER BY id DESC
            """, conn);
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        var list = new List<VersionSummary>();
        while (await reader.ReadAsync(ct))
        {
            list.Add(new VersionSummary(reader.GetInt64(0), reader.GetFieldValue<DateTimeOffset>(1), reader.GetString(2),
                reader.GetString(3), reader.GetInt32(4), reader.IsDBNull(5) ? null : reader.GetInt32(5), reader.GetBoolean(6)));
        }
        return list;
    }

    private static async Task<NpgsqlConnection> OpenAsync(string connectionString, CancellationToken ct)
    {
        var conn = new NpgsqlConnection(connectionString);
        await conn.OpenAsync(ct);
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
