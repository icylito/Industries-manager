using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using api_v2.Application.Health;
using api_v2.Application.Ports;
using api_v2.Infrastructure.Configuration;
using api_v2.Infrastructure.Persistence;
using api_v2.Domain.Rules;
using Npgsql;
using NpgsqlTypes;

namespace api_v2.Infrastructure.Persistence;

// Reads old rows out of a collector version and writes them into today's table, for Restore and Import.
// Old values get converted to today's types where they fit, anything that doesn't fit becomes empty (--)
// and the row remembers it in LostFields so the page shows a red triangle.
public class TableWriter(DatabaseConnections connections, RulesService rules) : ITableWriter
{
    private const string Table = "Industries";

    // Columns that aren't data, they're handled on their own
    private static readonly HashSet<string> SystemColumns = ["Id", "DuplicateOf", "ImportedFrom", "LostFields", "Extra"];

    // Restores and imports of big tables take longer than the 30 seconds a query normally gets
    private static readonly TimeSpan LongTimeout = TimeSpan.FromMinutes(10);

    // When a column gets renamed, a developer adds old name -> new name here so imports from older versions still land.
    // A request on the Requests page says when one is needed.
    public static readonly Dictionary<string, string> ColumnRenames = new(StringComparer.OrdinalIgnoreCase)
    {
    };

    public async Task<ImportPlan> PlanAsync(VersionDetail version, bool forRestore, CancellationToken ct)
    {
        await using var conn = new NpgsqlConnection(connections.Main);
        await conn.OpenAsync(ct);
        var columns = await CurrentColumnsAsync(conn, ct);
        var dataColumns = columns.Where(c => !SystemColumns.Contains(c.Key)).ToList();

        // Names already in the table, the row that owns each one
        var owners = new Dictionary<string, int>();
        if (!forRestore)
        {
            await using var cmd = new NpgsqlCommand($"""SELECT "Id", "Name" FROM "{Table}" WHERE "DuplicateOf" IS NULL ORDER BY "Id" """, conn);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) owners.TryAdd(Names.Key(reader.GetString(1)), reader.GetInt32(0));
        }

        var fields = rules.Current.Fields;
        var customRules = fields.Where(f => f.Custom).ToDictionary(f => f.Key);

        // Old columns that aren't columns today but match a custom field (old "Ticker", custom field "ticker") go into that field
        var oldColumns = version.Columns.Select(c => c.Name).Where(n => !SystemColumns.Contains(n)).ToList();
        var leftover = oldColumns.Where(old => !columns.ContainsKey(ColumnRenames.GetValueOrDefault(old, old))).ToList();
        var toCustom = leftover
            .Select(old => (Old: old, Rule: customRules.Values.FirstOrDefault(r =>
                string.Equals(r.Key, old, StringComparison.OrdinalIgnoreCase) || string.Equals(r.Label, old, StringComparison.OrdinalIgnoreCase))))
            .Where(m => m.Rule is not null)
            .ToDictionary(m => m.Old, m => m.Rule!);
        var unmatched = leftover.Where(old => !toCustom.ContainsKey(old)).ToList();
        var seenInBatch = new HashSet<string>();
        var planned = new List<PlannedRow>();
        var anyRuleProblem = false;

        foreach (var row in version.Rows)
        {
            var data = ReadObject(row);
            var lost = new List<string>();
            var problems = new List<RowProblem>();
            var values = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
            var columnValues = new Dictionary<string, object?>();

            foreach (var (column, type) in dataColumns)
            {
                var source = data.Keys.FirstOrDefault(k => string.Equals(ColumnRenames.GetValueOrDefault(k, k), column, StringComparison.Ordinal));
                object? value = null;
                if (source is not null)
                {
                    var (ok, converted) = Convert(data[source], type);
                    if (ok) value = converted;
                    else
                    {
                        var key = column.ToLowerInvariant();
                        lost.Add(key);
                        problems.Add(new("red", $"{LabelFor(key)} couldn't be brought over from the old data"));
                    }
                }
                columnValues[column] = value;
                values[column.ToLowerInvariant()] = value;
            }

            // Custom fields. Bring back drops values for fields that aren't in today's rules.
            // Restore keeps them, because restore brings the old rules back too. Hidden fields still count as current.
            JsonObject? extra = data.TryGetValue("Extra", out var extraJson) && extraJson.ValueKind == JsonValueKind.Object
                ? JsonNode.Parse(extraJson.GetRawText())!.AsObject()
                : null;
            foreach (var (old, rule) in toCustom)
            {
                if (!data.TryGetValue(old, out var oldValue) || oldValue.ValueKind == JsonValueKind.Null) continue;
                extra ??= new JsonObject();
                if (extra.ContainsKey(rule.Key) && extra[rule.Key] is not null) continue;
                extra[rule.Key] = JsonNode.Parse(oldValue.GetRawText());
            }
            if (!forRestore && extra is not null)
            {
                foreach (var extraKey in extra.Select(p => p.Key).ToList())
                {
                    if (!customRules.ContainsKey(extraKey)) extra.Remove(extraKey);
                }
                if (extra.Count == 0) extra = null;
            }

            if (extra is not null)
            {
                foreach (var (key, rule) in customRules)
                {
                    if (!extra.TryGetPropertyValue(key, out var node) || node is null) continue;
                    var (value, problem) = RulesService.FromJson(rule, JsonDocument.Parse(node.ToJsonString()).RootElement);
                    if (problem is null)
                    {
                        values[key] = value;
                        continue;
                    }
                    extra[key] = null;
                    lost.Add(key);
                    problems.Add(new("red", $"{rule.Label} couldn't be brought over from the old data"));
                }
            }

            foreach (var (_, ruleProblems) in rules.Validate(values))
            {
                problems.AddRange(ruleProblems.Select(p => new RowProblem("black", p)));
                anyRuleProblem = true;
            }

            // An id that isn't a whole number can't be put back, so that row is skipped
            var idUnreadable = data.TryGetValue("Id", out var idJson) && idJson.ValueKind != JsonValueKind.Null
                && !(idJson.ValueKind == JsonValueKind.Number && idJson.TryGetInt32(out _));
            var oldId = !idUnreadable && idJson.ValueKind == JsonValueKind.Number ? idJson.GetInt32() : (int?)null;
            var name = Names.Clean(values.GetValueOrDefault("name") as string);
            values["name"] = name;
            foreach (var key in columnValues.Keys.Where(k => string.Equals(k, "Name", StringComparison.OrdinalIgnoreCase)).ToList())
            {
                columnValues[key] = name;
            }
            string? skip = idUnreadable ? "A row has an id that isn't a whole number, so it was skipped"
                : string.IsNullOrEmpty(name) ? $"Row #{oldId} has no name, so it was skipped"
                : name!.Length > Names.MaxLength ? $"Row #{oldId} has a name longer than {Names.MaxLength} characters, so it was skipped"
                : null;

            int? similarTo = null;
            var similarInBatch = false;

            int? keepDuplicate = forRestore ? IntOrNull(data, "DuplicateOf") : null;
            int? keepImported = forRestore ? IntOrNull(data, "ImportedFrom") : null;
            if (forRestore && data.TryGetValue("LostFields", out var oldLost) && oldLost.ValueKind == JsonValueKind.Array)
            {
                lost.InsertRange(0, oldLost.EnumerateArray().Where(e => e.ValueKind == JsonValueKind.String)
                    .Select(e => e.GetString()!).Where(k => !lost.Contains(k)));
            }

            planned.Add(new PlannedRow(oldId, name, values, columnValues, extra, lost, problems, similarTo, similarInBatch, skip,
                keepDuplicate, keepImported));
        }

        // A version saved under the older, looser name rule can hold two originals today's rule says are one name.
        // The later becomes a copy of the earlier, the same as OneNameRule did to the live table, so the version can
        // still be restored and nothing in it is lost.
        if (forRestore)
        {
            var firstWith = new Dictionary<string, int>();
            foreach (var i in Enumerable.Range(0, planned.Count).OrderBy(i => planned[i].OldId ?? int.MaxValue))
            {
                var row = planned[i];
                if (row.Skip is not null || row.KeepDuplicateOf is not null || row.OldId is not int oldId
                    || string.IsNullOrEmpty(row.Name) || Names.HasNoLetters(row.Name)) continue;
                var key = Names.Key(row.Name);
                if (firstWith.TryGetValue(key, out var first))
                {
                    row.Problems.Add(new("black", $"Same name as row #{first} by today's name rule, so it comes back as a copy of it"));
                    planned[i] = row with { KeepDuplicateOf = first };
                }
                else firstWith[key] = oldId;
            }
        }

        if (!forRestore)
        {
            var keys = Names.Keys(planned.Where(p => p.Skip is null && !string.IsNullOrEmpty(p.Name)).Select(p => p.Name!));
            for (var i = 0; i < planned.Count; i++)
            {
                var row = planned[i];
                if (row.Skip is not null || string.IsNullOrEmpty(row.Name)) continue;
                var normal = keys[row.Name];
                if (owners.TryGetValue(normal, out var owner))
                {
                    row.Problems.Add(new("black", $"A similar row exists in this table in row #{owner}"));
                    planned[i] = row with { SimilarTo = owner };
                }
                else if (!seenInBatch.Add(normal))
                {
                    row.Problems.Add(new("black", "A similar row is in this import too"));
                    planned[i] = row with { SimilarInBatch = true };
                }
            }
        }

        var rulesDiffer = rules.Differs(version.Rules) || anyRuleProblem || unmatched.Count > 0 || planned.Any(p => p.Lost.Count > 0);
        return new ImportPlan(version.Summary.Id, rulesDiffer, unmatched, planned);
    }

    // How many rows in today's table an earlier import took from this version (ImportedFrom holds the version id)
    public async Task<int> CountImportedFromAsync(long versionId, CancellationToken ct)
    {
        // ImportedFrom is a 32 bit column, a version id past that can't have been written to it
        if (versionId is < 0 or > int.MaxValue) return 0;
        await using var conn = new NpgsqlConnection(connections.Main);
        await conn.OpenAsync(ct);
        await using var cmd = new NpgsqlCommand($"""SELECT count(*) FROM "{Table}" WHERE "ImportedFrom" = @id""", conn);
        cmd.Parameters.AddWithValue("id", (int)versionId);
        return (int)(long)(await cmd.ExecuteScalarAsync(ct))!;
    }

    // Adds the planned rows as new rows with new ids. Returns the new ids per planned row.
    // Snapshot is the row as it was saved, for the collector log.
    // The ids are taken from the sequence up front, so the rows can go in with one COPY and a row that
    // shares a name with an earlier row in the same import can still point at it.
    public async Task<List<(PlannedRow Row, int NewId, JsonElement Snapshot)>> ImportAsync(ImportPlan plan, CancellationToken ct)
    {
        await using var conn = new NpgsqlConnection(connections.Main);
        await conn.OpenAsync(ct);
        var columns = await CurrentColumnsAsync(conn, ct);
        await using var tx = await conn.BeginTransactionAsync(ct);

        // Owners get read again inside the transaction so nothing changed since the preview
        var owners = new Dictionary<string, int>();
        await using (var cmd = new NpgsqlCommand($"""SELECT "Id", "Name" FROM "{Table}" WHERE "DuplicateOf" IS NULL ORDER BY "Id" """, conn, tx))
        await using (var reader = await cmd.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct)) owners.TryAdd(Names.Key(reader.GetString(1)), reader.GetInt32(0));
        }

        var rows = plan.Rows.Where(r => r.Skip is null).ToList();
        if (rows.Count == 0)
        {
            await tx.CommitAsync(ct);
            return [];
        }
        var keys = Names.Keys(rows.Where(r => !string.IsNullOrEmpty(r.Name)).Select(r => r.Name!));
        var ids = await NextIdsAsync(conn, tx, rows.Count, ct);

        var planned = new List<(PlannedRow Row, int Id, int? DuplicateOf, int? ImportedFrom)>(rows.Count);
        for (var i = 0; i < rows.Count; i++)
        {
            var row = rows[i];
            var normal = keys[row.Name!];
            int? duplicateOf = owners.TryGetValue(normal, out var owner) ? owner : null;
            if (duplicateOf is null) owners[normal] = ids[i];
            planned.Add((row, ids[i], duplicateOf, (int)plan.VersionId));
        }
        await CopyRowsAsync(conn, columns, planned, ct);

        // The rows as they were saved, for the collector log
        var snapshots = new Dictionary<int, JsonElement>(rows.Count);
        await using (var read = new NpgsqlCommand($"""SELECT "Id", row_to_json(t)::text FROM "{Table}" t WHERE "Id" = ANY(@ids)""", conn, tx)
        {
            CommandTimeout = (int)LongTimeout.TotalSeconds
        })
        {
            read.Parameters.AddWithValue("ids", ids.ToArray());
            await using var reader = await read.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                snapshots[reader.GetInt32(0)] = JsonDocument.Parse(reader.GetString(1)).RootElement.Clone();
            }
        }
        await tx.CommitAsync(ct);
        return planned.Select(p => (p.Row, p.Id, snapshots[p.Id])).ToList();
    }

    // Takes the next n ids from the table's sequence, in order
    private static async Task<List<int>> NextIdsAsync(NpgsqlConnection conn, NpgsqlTransaction tx, int n, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand($"""
            SELECT nextval(pg_get_serial_sequence('"{Table}"', 'Id'))::int FROM generate_series(1, @n)
            """, conn, tx);
        cmd.Parameters.AddWithValue("n", n);
        var ids = new List<int>(n);
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct)) ids.Add(reader.GetInt32(0));
        return ids;
    }

    // Swaps every row in the table for the version's rows, keeping their old ids.
    // The caller owns the transaction, so the rules and the request can join it and it is all or nothing.
    // The rows go in with one COPY, so a table of 100,000 rows takes seconds instead of a round trip per row.
    public async Task<int> RestoreAsync(ImportPlan plan, NpgsqlConnection conn, NpgsqlTransaction tx, CancellationToken ct)
    {
        var columns = await CurrentColumnsAsync(conn, ct);

        await using (var clear = new NpgsqlCommand($"""DELETE FROM "{Table}" """, conn, tx) { CommandTimeout = (int)LongTimeout.TotalSeconds })
        {
            await clear.ExecuteNonQueryAsync(ct);
        }

        // A saved row with no id (it shouldn't happen, but a hand edited copy could) gets one after the highest old id
        var rows = plan.Rows.Where(r => r.Skip is null).ToList();
        var next = rows.Count == 0 ? 1 : rows.Max(r => r.OldId ?? 0) + 1;
        var planned = rows.Select(r => (r, r.OldId ?? next++, r.KeepDuplicateOf, r.KeepImportedFrom)).ToList();
        await CopyRowsAsync(conn, columns, planned, ct);

        // New rows carry on after the highest restored id
        await using (var seq = new NpgsqlCommand($"""
            SELECT setval(pg_get_serial_sequence('"{Table}"', 'Id'), coalesce((SELECT max("Id") FROM "{Table}"), 0) + 1, false)
            """, conn, tx))
        {
            await seq.ExecuteScalarAsync(ct);
        }
        return planned.Count;
    }

    // Writes rows with a binary COPY, inside whatever transaction the connection has open
    private static async Task CopyRowsAsync(NpgsqlConnection conn, Dictionary<string, string> columns,
        List<(PlannedRow Row, int Id, int? DuplicateOf, int? ImportedFrom)> rows, CancellationToken ct)
    {
        if (rows.Count == 0) return;
        var data = rows[0].Row.Columns.Keys.ToList();
        var names = new List<string> { "Id" };
        names.AddRange(data);
        names.AddRange(["DuplicateOf", "ImportedFrom", "LostFields", "Extra"]);
        var list = string.Join(", ", names.Select(n => $"\"{n}\""));

        await using var copy = await conn.BeginBinaryImportAsync($"""COPY "{Table}" ({list}) FROM STDIN (FORMAT BINARY)""", ct);
        copy.Timeout = LongTimeout;
        foreach (var (row, id, duplicateOf, importedFrom) in rows)
        {
            await copy.StartRowAsync(ct);
            await copy.WriteAsync(id, NpgsqlDbType.Integer, ct);
            foreach (var column in data)
            {
                var value = row.Columns[column];
                if (value is string s && column == "Name") value = s.Trim();
                if (value is null) await copy.WriteNullAsync(ct);
                else await copy.WriteAsync(value, DbType(columns[column]), ct);
            }
            await Write(copy, duplicateOf, NpgsqlDbType.Integer, ct);
            await Write(copy, importedFrom, NpgsqlDbType.Integer, ct);
            await Write(copy, row.Lost.Count > 0 ? row.Lost.Distinct().ToArray() : null, NpgsqlDbType.Array | NpgsqlDbType.Text, ct);
            await Write(copy, row.Extra?.ToJsonString(), NpgsqlDbType.Jsonb, ct);
        }
        await copy.CompleteAsync(ct);

        static async Task Write(NpgsqlBinaryImporter copy, object? value, NpgsqlDbType type, CancellationToken ct)
        {
            if (value is null) await copy.WriteNullAsync(ct);
            else await copy.WriteAsync(value, type, ct);
        }
    }

    private static async Task<Dictionary<string, string>> CurrentColumnsAsync(NpgsqlConnection conn, CancellationToken ct)
    {
        var columns = new Dictionary<string, string>();
        await using var cmd = new NpgsqlCommand(
            $"SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '{Table}' ORDER BY ordinal_position", conn);
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct)) columns[reader.GetString(0)] = reader.GetString(1);
        return columns;
    }

    private string LabelFor(string key) =>
        rules.Current.Fields.FirstOrDefault(f => f.Key == key)?.Label ?? key;

    private static Dictionary<string, JsonElement> ReadObject(JsonElement row)
    {
        var data = new Dictionary<string, JsonElement>();
        foreach (var p in row.EnumerateObject()) data[p.Name] = p.Value;
        return data;
    }

    private static int? IntOrNull(Dictionary<string, JsonElement> data, string key) =>
        data.TryGetValue(key, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var i) ? i : null;

    // Old JSON value into today's column type. Null always fits.
    public static (bool Ok, object? Value) Convert(JsonElement value, string dataType)
    {
        if (value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined) return (true, null);
        var text = value.ValueKind == JsonValueKind.String ? value.GetString()! : value.GetRawText();
        var inv = CultureInfo.InvariantCulture;
        return dataType switch
        {
            "integer" or "smallint" => int.TryParse(text, NumberStyles.Integer, inv, out var i) ? (true, i) : (false, null),
            "bigint" => long.TryParse(text, NumberStyles.Integer, inv, out var l) ? (true, l) : (false, null),
            "numeric" => decimal.TryParse(text, NumberStyles.Float, inv, out var d) ? (true, d) : (false, null),
            "real" or "double precision" => double.TryParse(text, NumberStyles.Float, inv, out var f) ? (true, f) : (false, null),
            "date" => DateOnly.TryParse(text.Length >= 10 ? text[..10] : text, inv, out var date) ? (true, date) : (false, null),
            "boolean" => bool.TryParse(text, out var b) ? (true, b) : (false, null),
            _ when dataType.StartsWith("timestamp") => DateTime.TryParse(text, inv, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var t)
                ? (true, DateTime.SpecifyKind(t, DateTimeKind.Utc)) : (false, null),
            _ => (true, text)
        };
    }

    private static NpgsqlDbType DbType(string dataType) => dataType switch
    {
        "integer" => NpgsqlDbType.Integer,
        "smallint" => NpgsqlDbType.Smallint,
        "bigint" => NpgsqlDbType.Bigint,
        "numeric" => NpgsqlDbType.Numeric,
        "real" => NpgsqlDbType.Real,
        "double precision" => NpgsqlDbType.Double,
        "date" => NpgsqlDbType.Date,
        "boolean" => NpgsqlDbType.Boolean,
        "timestamp with time zone" => NpgsqlDbType.TimestampTz,
        "timestamp without time zone" => NpgsqlDbType.Timestamp,
        "jsonb" => NpgsqlDbType.Jsonb,
        _ => NpgsqlDbType.Text
    };
}
