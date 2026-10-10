using System.Text.Json;
using System.Text.Json.Nodes;
using api_v2.Rules;

namespace api_v2.Tables;

// What the page sends for one column. Key is empty for a new column; the API makes it from the label.
public record ColumnInput(string? Key, string? Label, string? Type, bool Required = false, int? MaxLength = null,
    decimal? Min = null, decimal? Max = null, List<string>? Options = null);

// The limits the user chose (2026-10-09). Each refusal names the one that was hit.
public static class TableLimits
{
    public const int Tables = 50;
    public const int Columns = 20;
    public const int Rows = 100_000;
    public const int RowBytes = 64 * 1024;
    public const int NameLength = 60;
    // Removed columns keep their values (put the column back and they return), but not forever
    public const int ColumnsKept = 60;
    public const int Options = 50;
    public const int OptionLength = 100;
    public static readonly TimeSpan BinKeeps = TimeSpan.FromDays(14);
}

// Checks a table's name, its columns and its rows. Columns reuse FieldRule and the Fields page's own checks
// (RulesService), so a column behaves exactly like a custom field does.
public static class TableShape
{
    public static readonly JsonSerializerOptions Json = RulesService.Json;

    // The cleaned name, or the problem with it
    public static (string? Name, string? Problem) CheckName(string? raw)
    {
        var name = Names.Clean(raw);
        if (string.IsNullOrEmpty(name)) return (null, "Give the table a name");
        if (Names.HasNoLetters(name)) return (null, Names.NoKeyMessage);
        if (name.Length > TableLimits.NameLength) return (null, $"A table name can be at most {TableLimits.NameLength} characters");
        return (name, null);
    }

    public static List<FieldRule> Parse(string json) => RulesService.ParseFields(json);

    public static string Write(IEnumerable<FieldRule> columns) => JsonSerializer.Serialize(columns, Json);

    // Turns what the page sent into the table's new column list. Existing columns keep their key; a column left
    // out of the list is hidden, not deleted, so its values come back if it is added again; a new column gets a
    // fresh key. Problems are keyed columns[i], the same shape the Fields page reads.
    public static (List<FieldRule> Columns, Dictionary<string, string[]> Errors) Merge(
        IReadOnlyList<FieldRule> current, IReadOnlyList<ColumnInput>? incoming)
    {
        var errors = new Dictionary<string, string[]>();
        var list = incoming ?? [];
        if (list.Count == 0) errors["columns"] = ["A table needs at least one column"];
        if (list.Count > TableLimits.Columns) errors["columns"] = [$"A table can have at most {TableLimits.Columns} columns"];
        if (errors.Count > 0) return ([], errors);

        var byKey = current.ToDictionary(c => c.Key);
        var taken = new HashSet<string>(current.Select(c => c.Key));
        // Column names are names: two are the same when their keys match (Names.Key)
        var labels = new HashSet<string>();
        var used = new HashSet<string>();
        var result = new List<FieldRule>();

        for (var i = 0; i < list.Count; i++)
        {
            var input = list[i];
            var type = input.Type?.Trim().ToLowerInvariant() ?? "";
            var label = Names.Clean(input.Label) ?? "";
            var problems = RulesService.CheckLimits(label, type, input.MaxLength, input.Min, input.Max);
            if (type is not ("text" or "number" or "date")) problems.Add("Type has to be text, number or date");
            if (label.Length > 0 && Names.HasNoLetters(label)) problems.Add(Names.NoKeyMessage);
            else if (label.Length > 0 && !labels.Add(Names.Key(label))) problems.Add("Two columns can't have the same name");

            var options = (input.Options ?? []).Select(o => Names.Clean(o) ?? "").Where(o => o.Length > 0)
                .Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            if (options.Count > 0 && type != "text") problems.Add("A list of choices only works on text");
            if (options.Count > TableLimits.Options) problems.Add($"A column can have at most {TableLimits.Options} choices");
            if (options.Any(o => o.Length > TableLimits.OptionLength))
                problems.Add($"Each choice can be at most {TableLimits.OptionLength} characters");

            string key;
            if (string.IsNullOrEmpty(input.Key))
            {
                key = RulesService.MakeKey(label.Length > 0 ? label : "column", taken);
            }
            else if (byKey.ContainsKey(input.Key) && used.Add(input.Key))
            {
                key = input.Key;
            }
            else
            {
                problems.Add("That column isn't part of this table any more. Reload and try again");
                key = input.Key;
            }

            if (problems.Count > 0)
            {
                errors[$"columns[{i}]"] = [.. problems];
                continue;
            }
            result.Add(new FieldRule(key, label, type, input.Required, input.MaxLength, input.Min, input.Max,
                Custom: true, Hidden: false, Options: options.Count > 0 ? options : null));
        }

        // Columns left out are kept hidden with their values, newest first, up to a cap
        var hidden = current.Where(c => !result.Any(r => r.Key == c.Key))
            .Select(c => c with { Hidden = true })
            .Take(Math.Max(0, TableLimits.ColumnsKept - result.Count));
        result.AddRange(hidden);
        return (result, errors);
    }

    // Reads one row from the page against the visible columns. Values the person didn't send keep what the row
    // already had, so a hidden column's values survive an edit. Unknown keys are refused, not dropped quietly.
    public static (JsonObject Data, Dictionary<string, string[]> Errors) ReadRow(
        IReadOnlyList<FieldRule> columns, Dictionary<string, JsonElement>? values, JsonObject? existing)
    {
        var errors = new Dictionary<string, string[]>();
        var visible = columns.Where(c => !c.Hidden).ToDictionary(c => c.Key);
        var input = values ?? [];
        foreach (var key in input.Keys.Where(k => !visible.ContainsKey(k)))
        {
            errors[key] = ["That column isn't part of this table. Reload and try again"];
        }

        var data = existing is null ? new JsonObject() : (JsonObject)existing.DeepClone();
        foreach (var column in visible.Values)
        {
            object? value;
            if (input.TryGetValue(column.Key, out var element))
            {
                var (parsed, problem) = RulesService.FromJson(column, element);
                if (problem is not null) { errors[column.Key] = [problem]; continue; }
                value = parsed;
            }
            else
            {
                value = existing is not null && existing.TryGetPropertyValue(column.Key, out var kept) && kept is not null
                    ? RulesService.FromJson(column, JsonSerializer.SerializeToElement(kept)).Value
                    : null;
            }

            var (stored, issue) = Check(column, value);
            if (issue is not null) { errors[column.Key] = [issue]; continue; }
            data[column.Key] = ToNode(stored);
        }

        if (errors.Count == 0 && JsonSerializer.SerializeToUtf8Bytes(data, Json).Length > TableLimits.RowBytes)
        {
            errors["row"] = [$"A row can hold at most {TableLimits.RowBytes / 1024} KB"];
        }
        return (data, errors);
    }

    // One value against one column's rules. Stored is what goes into the row's JSON.
    public static (object? Stored, string? Problem) Check(FieldRule column, object? value)
    {
        switch (column.Type)
        {
            case "text":
                var (text, problem) = RulesService.CheckText(column, value as string, null);
                return (text, problem);
            case "number":
                return (value, RulesService.CheckNumber(column, value as decimal?));
            default:
                if (value is null) return (null, column.Required ? $"{column.Label} is required" : null);
                return (RulesService.ToStored(value), null);
        }
    }

    // Before a column change is saved: how many rows would break under the new columns, with one example.
    // A changed type also rewrites the values, so a number column turned to text stores text.
    public static (int Blocked, string? Example, JsonObject? Rewritten) Recheck(IReadOnlyList<FieldRule> columns, JsonObject data,
        IReadOnlySet<string> retyped)
    {
        JsonObject? rewritten = null;
        foreach (var column in columns.Where(c => !c.Hidden))
        {
            data.TryGetPropertyValue(column.Key, out var node);
            object? value = null;
            if (node is not null)
            {
                var (parsed, problem) = RulesService.FromJson(column, JsonSerializer.SerializeToElement(node));
                if (problem is not null) return (1, problem, null);
                value = parsed;
            }
            var (stored, issue) = Check(column, value);
            if (issue is not null) return (1, issue, null);
            if (retyped.Contains(column.Key))
            {
                rewritten ??= (JsonObject)data.DeepClone();
                rewritten[column.Key] = ToNode(stored);
            }
        }
        return (0, null, rewritten);
    }

    // Only text and numbers are ever stored: dates are already "yyyy-MM-dd" text by now
    public static JsonNode? ToNode(object? value) => value switch
    {
        null => null,
        decimal number => JsonValue.Create(number),
        string text => JsonValue.Create(text),
        _ => JsonValue.Create(Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture))
    };

    // A file name piece from a table name: lowercase letters, digits and dashes only, never a path
    public static string Slug(string name)
    {
        var slug = System.Text.RegularExpressions.Regex.Replace(name.ToLowerInvariant(), "[^a-z0-9]+", "-").Trim('-');
        if (slug.Length > 40) slug = slug[..40].Trim('-');
        return slug.Length == 0 ? "table" : slug;
    }
}
