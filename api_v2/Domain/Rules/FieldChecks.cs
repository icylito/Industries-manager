using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace api_v2.Domain.Rules;

// What a row from the page turns into after reading its fields against the rules
public record RowInput(Dictionary<string, object?> Values, Dictionary<string, object?> Custom, Dictionary<string, string[]> Errors);

// Checks rows and field lists against a set of rules. Pure: the rules are passed in, so this works without a database.
public static class FieldChecks
{
    public const int DefaultCustomTextMax = 1000;
    private const int MaxDecimals = 4;

    // Reads a row from the page: the 4 built in fields plus the custom ones in Extra.
    // currentSector is the sector already stored on the row. An edit may keep that value even when it isn't in the list.
    // existingExtra is the row's stored custom values. A custom field the caller didn't send keeps its stored value.
    public static RowInput Read(RuleSet rules, string? name, string? sector, decimal? price, DateOnly? release,
        Dictionary<string, JsonElement>? extra, string? currentSector = null, string? existingExtra = null)
    {
        var kept = existingExtra is null ? null : JsonNode.Parse(existingExtra) as JsonObject;
        var values = new Dictionary<string, object?>
        {
            ["name"] = Names.Clean(name),
            ["sector"] = sector,
            ["price"] = price,
            ["release"] = release
        };
        var custom = new Dictionary<string, object?>();
        var errors = new Dictionary<string, string[]>();
        if (sector is not null && Names.HasHiddenCharacters(sector))
        {
            var label = rules.Fields.FirstOrDefault(f => f.Key == "sector")?.Label ?? "Sector";
            errors["sector"] = [$"{label} can't contain line breaks or hidden characters"];
        }

        foreach (var rule in rules.Fields.Where(f => f.Custom && !f.Hidden))
        {
            JsonElement element = default;
            var given = extra is not null && extra.TryGetValue(rule.Key, out element);
            if (!given)
            {
                // Not sent, so the stored value stays as it is. It still counts for the checks (Required, limits).
                object? stored = null;
                if (kept is not null && kept.TryGetPropertyValue(rule.Key, out var node) && node is not null)
                {
                    stored = RuleJson.FromJson(rule, JsonDocument.Parse(node.ToJsonString()).RootElement).Value;
                }
                values[rule.Key] = stored;
                continue;
            }
            var (value, problem) = RuleJson.FromJson(rule, element);
            if (problem is not null)
            {
                errors[rule.Key] = [problem];
                continue;
            }
            values[rule.Key] = value;
            custom[rule.Key] = value;
        }

        // A matching choice is stored with the spelling from the list ("private sector" becomes "Private Sector")
        foreach (var rule in rules.Fields.Where(f => !f.Hidden && f.Type == "text" && f.Options is { Count: > 0 }))
        {
            var keep = rule.Key == "sector" ? currentSector : null;
            var (stored, problem) = CheckText(rule, values.GetValueOrDefault(rule.Key) as string, keep);
            if (problem is null) values[rule.Key] = stored;
        }

        foreach (var (key, problems) in Validate(rules, values, currentSector))
        {
            errors.TryAdd(key, problems);
        }
        return new RowInput(values, custom, errors);
    }

    // Field key to its problems, the same shape ValidationProblem sends back
    public static Dictionary<string, string[]> Validate(RuleSet rules, IReadOnlyDictionary<string, object?> values, string? currentSector = null)
    {
        var errors = new Dictionary<string, string[]>();
        foreach (var rule in rules.Fields.Where(f => !f.Hidden))
        {
            values.TryGetValue(rule.Key, out var value);
            var keep = rule.Key == "sector" ? currentSector : null;
            var problem = rule.Type switch
            {
                "text" => CheckText(rule, value as string, keep).Problem,
                "number" => CheckNumber(rule, value as decimal?),
                _ => rule.Required && value is null ? $"{rule.Label} is required" : null
            };
            if (problem is not null)
            {
                errors[rule.Key] = [problem];
            }
        }
        return errors;
    }

    // Stored is the value to keep. A choice is rewritten to the list's own spelling.
    public static (string? Stored, string? Problem) CheckText(FieldRule rule, string? text, string? keep)
    {
        text = string.IsNullOrWhiteSpace(text) ? null : text.Trim();
        if (string.IsNullOrEmpty(text))
        {
            return (null, rule.Required ? $"{rule.Label} is required" : null);
        }

        if (rule.Options is { Count: > 0 })
        {
            var match = rule.Options.FirstOrDefault(o => string.Equals(o, text, StringComparison.OrdinalIgnoreCase));
            if (match is not null)
            {
                text = match;
            }
            else if (keep is not null && string.Equals(keep.Trim(), text, StringComparison.OrdinalIgnoreCase))
            {
                text = keep.Trim();
            }
            else
            {
                return (text, $"{rule.Label} has to be one of: {string.Join(", ", rule.Options)}");
            }
        }

        // A custom text field with no limit set still gets one, so a huge value can't end up in every saved copy
        var limit = rule.MaxLength ?? (rule.Custom ? DefaultCustomTextMax : (int?)null);
        if (limit is int max && text.Length > max)
        {
            return (text, $"{rule.Label} can be at most {max} characters");
        }
        return (text, null);
    }

    // Digits after the decimal point, not counting trailing zeros
    private static int Decimals(decimal d) => (decimal.GetBits(d / 1.0000000000000000000000000000m)[3] >> 16) & 0xFF;

    public static string? CheckNumber(FieldRule rule, decimal? number)
    {
        if (number is not decimal n)
        {
            return rule.Required ? $"{rule.Label} is required" : null;
        }
        if (Decimals(n) > MaxDecimals)
        {
            return $"{rule.Label} can have at most {MaxDecimals} decimal places";
        }
        var tooLow = rule.Min is decimal low && n < low;
        var tooHigh = rule.Max is decimal high && n > high;
        if (!tooLow && !tooHigh)
        {
            return null;
        }
        return (rule.Min, rule.Max) switch
        {
            (decimal min, decimal max) => $"{rule.Label} has to be between {Show(min)} and {Show(max)}",
            (decimal min, null) => $"{rule.Label} has to be at least {Show(min)}",
            (_, decimal max) => $"{rule.Label} has to be at most {Show(max)}",
            _ => null
        };
    }

    private static string Show(decimal d) => ((double)d).ToString(CultureInfo.InvariantCulture);

    // Limits, labels and hiding custom fields change here. New fields come in through AddFieldsAsync.
    // This save still can't drop a field. Removing one goes through DELETE /schema/fields/{key}.
    public static Dictionary<string, string[]> CheckNewRules(RuleSet current, SaveRules body)
    {
        var errors = new Dictionary<string, string[]>();
        var incoming = body.Fields ?? [];
        if (incoming.Any(f => f is null || f.Key is null || f.Label is null))
        {
            errors["fields"] = ["Every field needs a key and a label"];
            return errors;
        }

        var now = current.Fields.ToDictionary(f => f.Key);
        var noDuplicates = incoming.Select(f => f.Key).Distinct().Count() == incoming.Count;
        var everyKeyExists = incoming.All(f => now.ContainsKey(f.Key));

        // A page opened before a field was added sends a shorter list of keys that are all still real
        if (everyKeyExists && noDuplicates && incoming.Count < now.Count)
        {
            errors["fields"] = ["The fields changed since you opened this page. Reload and try again"];
            return errors;
        }

        if (incoming.Count != now.Count || !everyKeyExists || !noDuplicates)
        {
            errors["fields"] = ["Send every field once. Fields can't be removed, hide a custom field instead"];
            return errors;
        }

        // Labels are names: two are the same when their keys match (Names.Key)
        var labels = new HashSet<string>();
        foreach (var field in incoming)
        {
            var was = now[field.Key];
            var problems = CheckLimits(field.Label, field.Type, field.MaxLength, field.Min, field.Max);
            if (field.Type != was.Type) problems.Add($"{was.Label} can't change type here, ask a developer from the Fields page");
            if (field.Custom != was.Custom) problems.Add("A field can't switch between built in and custom");
            if (field.Hidden && !was.Custom) problems.Add($"{was.Label} is built in, only custom fields can be hidden");
            if (field.Key == "name" && !field.Required) problems.Add("Name always has to be filled in");
            if (field.Key == "name" && field.MaxLength is not (>= 1 and <= Names.MaxLength))
                problems.Add("Name can be at most 200 characters");
            if (!string.IsNullOrWhiteSpace(field.Label) && Names.HasNoLetters(field.Label)) problems.Add(Names.NoKeyMessage);
            else if (!labels.Add(Names.Key(field.Label))) problems.Add("Two fields can't have the same label");
            if (problems.Count > 0) errors[field.Key] = [.. problems];
        }
        return errors;
    }

    public static Dictionary<string, string[]> CheckNewField(RuleSet current, NewField field)
    {
        var errors = CheckNewFields(current, [field]);
        return errors.Count > 0 ? new() { ["field"] = errors["fields[0]"] } : [];
    }

    // One problem list per field, keyed fields[0], fields[1], ... Nothing is saved unless every field is fine.
    public static Dictionary<string, string[]> CheckNewFields(RuleSet current, IReadOnlyList<NewField> fields)
    {
        var errors = new Dictionary<string, string[]>();
        var seen = new HashSet<string>();
        var custom = current.Fields.Count(f => f.Custom);
        for (var i = 0; i < fields.Count; i++)
        {
            var field = fields[i];
            var problems = CheckLimits(field.Label, field.Type, field.MaxLength, field.Min, field.Max);
            if (field.Type is not ("text" or "number" or "date")) problems.Add("Type has to be text, number or date");
            var label = field.Label?.Trim() ?? "";
            var key = Names.Key(label);
            if (label.Length > 0 && Names.HasNoLetters(label))
                problems.Add(Names.NoKeyMessage);
            else if (label.Length > 0 && current.Fields.Any(f => Names.Key(f.Label) == key))
                problems.Add("A field with that label already exists");
            else if (label.Length > 0 && !seen.Add(key))
                problems.Add("A field with that label already exists");
            if (custom + i + 1 > 30) problems.Add("There can be at most 30 custom fields");
            if (problems.Count > 0) errors[$"fields[{i}]"] = [.. problems];
        }
        return errors;
    }

    public static List<string> CheckLimits(string? label, string type, int? maxLength, decimal? min, decimal? max)
    {
        var problems = new List<string>();
        if (string.IsNullOrWhiteSpace(label) || label.Trim().Length > 40) problems.Add("The label has to be 1 to 40 characters");
        if (label is not null && Names.HasHiddenCharacters(label))
            problems.Add("The label can't contain line breaks or hidden characters");
        if (maxLength is not null && (type != "text" || maxLength is < 1 or > 1000))
            problems.Add("Max length only works on text and has to be 1 to 1000");
        if ((min is not null || max is not null) && type != "number") problems.Add("Min and max only work on numbers");
        if (min is decimal low && max is decimal high && low > high) problems.Add("Min can't be above max");
        return problems;
    }

    // "Added the field A", "Added the fields A and B", "Added the fields A, B and C"
    public static string AddedNote(IReadOnlyList<string> labels)
    {
        if (labels.Count <= 1) return $"Added the field {labels.FirstOrDefault()}";
        if (labels.Count == 2) return $"Added the fields {labels[0]} and {labels[1]}";
        return $"Added the fields {string.Join(", ", labels.Take(labels.Count - 1))} and {labels[^1]}";
    }

    // Built in object names, and id/extra, so a custom field can't hide a real property
    private static readonly HashSet<string> ReservedKeys =
    [
        "constructor", "prototype", "proto", "tostring", "valueof", "hasownproperty",
        "isprototypeof", "propertyisenumerable", "tolocalestring", "id", "extra"
    ];

    // "Stock ticker" becomes "stock_ticker", with a number on the end if it's taken. Letters from other languages stay.
    // taken includes keys already handed out in this batch, so two similar labels don't collide.
    public static string MakeKey(string label, HashSet<string> taken)
    {
        // Accents come off ("Ümläut" becomes "umlaut"), letters and digits from any language stay
        var plain = Regex.Replace(label.Normalize(NormalizationForm.FormKD), @"\p{Mn}+", "");
        var slug = Regex.Replace(plain.ToLowerInvariant(), @"[^\p{L}\p{N}]+", "_").Trim('_');
        if (slug.Length == 0) slug = "field";
        if (ReservedKeys.Contains(slug)) slug += "_field";
        var key = slug;
        for (var n = 2; taken.Contains(key); n++) key = $"{slug}_{n}";
        taken.Add(key);
        return key;
    }
}
