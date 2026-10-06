using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using api_v2.Data;
using api_v2.Rules;
using Npgsql;
using NpgsqlTypes;

namespace api_v2.History;

public record RowProblem(string Level, string Text);

// One old row after it's been fitted into today's table. Level "red" means data didn't make it, "black" is minor.
public record PlannedRow(int? OldId, string? Name, Dictionary<string, object?> Values, Dictionary<string, object?> Columns,
    JsonObject? Extra, List<string> Lost, List<RowProblem> Problems, int? SimilarTo, bool SimilarInBatch, string? Skip,
    int? KeepDuplicateOf, int? KeepImportedFrom);

public record ImportPlan(long VersionId, bool RulesDiffer, List<string> UnmatchedColumns, List<PlannedRow> Rows);

// Reads old rows out of a collector version and writes them into today's table, for Restore and Import.
// Old values get converted to today's types where they fit, anything that doesn't fit becomes empty (--)
// and the row remembers it in LostFields so the page shows a red triangle.
public class TableWriter(DatabaseConnections connections, RulesService rules)
{
    private const string Table = "Industries";

    // Columns that aren't data, they're handled on their own
    private static readonly HashSet<string> SystemColumns = ["Id", "DuplicateOf", "ImportedFrom", "LostFields", "Extra"];

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
            await using var cmd = new NpgsqlCommand($"""SELECT "Id", lower(btrim("Name")) FROM "{Table}" WHERE "DuplicateOf" IS NULL""", conn);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) owners.TryAdd(reader.GetString(1), reader.GetInt32(0));
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

            var oldId = data.TryGetValue("Id", out var idJson) && idJson.ValueKind == JsonValueKind.Number ? idJson.GetInt32() : (int?)null;
            var name = Names.Clean(values.GetValueOrDefault("name") as string);
            values["name"] = name;
            foreach (var key in columnValues.Keys.Where(k => string.Equals(k, "Name", StringComparison.OrdinalIgnoreCase)).ToList())
            {
                columnValues[key] = name;
            }
            string? skip = string.IsNullOrEmpty(name) ? $"Row #{oldId} has no name, so it was skipped"
                : name!.Length > Names.MaxLength ? $"Row #{oldId} has a name longer than {Names.MaxLength} characters, so it was skipped"
                : null;

            int? similarTo = null;
            var similarInBatch = false;

            int? keepDuplicate = forRestore ? IntOrNull(data, "DuplicateOf") : null;
            int? keepImported = forRestore ? IntOrNull(data, "ImportedFrom") : null;
            if (forRestore && data.TryGetValue("LostFields", out var oldLost) && oldLost.ValueKind == JsonValueKind.Array)
            {
                lost.InsertRange(0, oldLost.EnumerateArray().Select(e => e.GetString()!).Where(k => !lost.Contains(k)));
            }

            planned.Add(new PlannedRow(oldId, name, values, columnValues, extra, lost, problems, similarTo, similarInBatch, skip,
                keepDuplicate, keepImported));
        }

        if (!forRestore)
        {
            var keys = await Names.KeysAsync(conn, null,
                planned.Where(p => p.Skip is null && !string.IsNullOrEmpty(p.Name)).Select(p => p.Name!), ct);
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

    // Adds the planned rows as new rows with new ids. Returns the new ids per planned row.
    public async Task<List<(PlannedRow Row, int NewId)>> ImportAsync(ImportPlan plan, CancellationToken ct)
    {
        await using var conn = new NpgsqlConnection(connections.Main);
        await conn.OpenAsync(ct);
        var columns = await CurrentColumnsAsync(conn, ct);
        await using var tx = await conn.BeginTransactionAsync(ct);

        // Owners get read again inside the transaction so nothing changed since the preview
        var owners = new Dictionary<string, int>();
        await using (var cmd = new NpgsqlCommand($"""SELECT "Id", lower(btrim("Name")) FROM "{Table}" WHERE "DuplicateOf" IS NULL""", conn, tx))
        await using (var reader = await cmd.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct)) owners.TryAdd(reader.GetString(1), reader.GetInt32(0));
        }

        var keys = await Names.KeysAsync(conn, tx,
            plan.Rows.Where(r => r.Skip is null && !string.IsNullOrEmpty(r.Name)).Select(r => r.Name!), ct);
        var added = new List<(PlannedRow, int)>();
        foreach (var row in plan.Rows.Where(r => r.Skip is null))
        {
            var normal = keys[row.Name!];
            int? duplicateOf = owners.TryGetValue(normal, out var owner) ? owner : null;
            var id = await InsertAsync(conn, tx, columns, row, id: null, duplicateOf, (int)plan.VersionId, ct);
            if (duplicateOf is null) owners[normal] = id;
            added.Add((row, id));
        }
        await tx.CommitAsync(ct);
        return added;
    }

    // Swaps every row in the table for the version's rows, keeping their old ids. One transaction, all or nothing.
    public async Task<int> RestoreAsync(ImportPlan plan, CancellationToken ct)
    {
        await using var conn = new NpgsqlConnection(connections.Main);
        await conn.OpenAsync(ct);
        var columns = await CurrentColumnsAsync(conn, ct);
        await using var tx = await conn.BeginTransactionAsync(ct);

        await using (var clear = new NpgsqlCommand($"""DELETE FROM "{Table}" """, conn, tx))
        {
            await clear.ExecuteNonQueryAsync(ct);
        }

        var count = 0;
        foreach (var row in plan.Rows.Where(r => r.Skip is null))
        {
            await InsertAsync(conn, tx, columns, row, row.OldId, row.KeepDuplicateOf, row.KeepImportedFrom, ct);
            count++;
        }

        // New rows carry on after the highest restored id
        await using (var seq = new NpgsqlCommand($"""
            SELECT setval(pg_get_serial_sequence('"{Table}"', 'Id'), coalesce((SELECT max("Id") FROM "{Table}"), 0) + 1, false)
            """, conn, tx))
        {
            await seq.ExecuteScalarAsync(ct);
        }
        await tx.CommitAsync(ct);
        return count;
    }

    private static async Task<int> InsertAsync(NpgsqlConnection conn, NpgsqlTransaction tx, Dictionary<string, string> columns,
        PlannedRow row, int? id, int? duplicateOf, int? importedFrom, CancellationToken ct)
    {
        var names = new List<string>();
        var cmd = new NpgsqlCommand { Connection = conn, Transaction = tx };
        void Add(string column, object? value, NpgsqlDbType type)
        {
            names.Add(column);
            cmd.Parameters.Add(new NpgsqlParameter($"p{names.Count}", type) { Value = value ?? DBNull.Value });
        }

        if (id is not null) Add("Id", id, NpgsqlDbType.Integer);
        foreach (var (column, value) in row.Columns)
        {
            Add(column, value is string s && column == "Name" ? s.Trim() : value, DbType(columns[column]));
        }
        Add("DuplicateOf", duplicateOf, NpgsqlDbType.Integer);
        Add("ImportedFrom", importedFrom, NpgsqlDbType.Integer);
        Add("LostFields", row.Lost.Count > 0 ? row.Lost.Distinct().ToArray() : null, NpgsqlDbType.Array | NpgsqlDbType.Text);
        Add("Extra", row.Extra?.ToJsonString(), NpgsqlDbType.Jsonb);

        var list = string.Join(", ", names.Select(n => $"\"{n}\""));
        var parameters = string.Join(", ", names.Select((_, i) => $"@p{i + 1}"));
        cmd.CommandText = $"""INSERT INTO "{Table}" ({list}) VALUES ({parameters}) RETURNING "Id" """;
        await using (cmd)
        {
            return (int)(await cmd.ExecuteScalarAsync(ct))!;
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
