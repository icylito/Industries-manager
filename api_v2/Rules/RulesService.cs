using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using api_v2.Data;
using api_v2.Model;
using Microsoft.EntityFrameworkCore;

namespace api_v2.Rules;

// What a row from the page turns into after reading its fields against the rules
public record RowInput(Dictionary<string, object?> Values, Dictionary<string, object?> Custom, Dictionary<string, string[]> Errors);

// Keeps the rules in use in memory and checks rows against them. The rules themselves live
// in the RuleVersions table, so changing a limit is a save, not a code change.
public class RulesService(CollectorStore collector)
{
    public static readonly JsonSerializerOptions Json = JsonSerializerOptions.Web;
    private readonly SemaphoreSlim _saving = new(1, 1);
    private RuleSet? _current;

    public RuleSet Current => _current ?? throw new InvalidOperationException("Rules aren't loaded yet");

    // Runs on startup after migrations. A fresh database gets version 1 with the starting limits.
    public async Task LoadAsync(AppDbContext db, CancellationToken ct)
    {
        var latest = await db.RuleVersions.OrderByDescending(r => r.Id).FirstOrDefaultAsync(ct);
        if (latest is null)
        {
            latest = new RuleVersion
            {
                CreatedAt = DateTimeOffset.UtcNow,
                ChangedBy = "system",
                Note = "Starting rules",
                Fields = JsonSerializer.Serialize(DefaultRules.Industries, Json)
            };
            db.RuleVersions.Add(latest);
            await db.SaveChangesAsync(ct);
        }
        _current = ToRuleSet(latest);
    }

    public static RuleSet ToRuleSet(RuleVersion row) => new(row.Id, row.CreatedAt, row.ChangedBy, row.Note, ParseFields(row.Fields));

    public static List<FieldRule> ParseFields(string json) => JsonSerializer.Deserialize<List<FieldRule>>(json, Json)!;

    // True when old rules (from a saved version) don't match the rules in use
    public bool Differs(string? oldRulesJson)
    {
        if (oldRulesJson is null) return true;
        return !ParseFields(oldRulesJson).SequenceEqual(Current.Fields);
    }

    // Reads a row from the page: the 4 built in fields plus the custom ones in Extra
    public RowInput Read(string? name, string? sector, decimal? price, DateOnly? release, Dictionary<string, JsonElement>? extra)
    {
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
            var label = Current.Fields.FirstOrDefault(f => f.Key == "sector")?.Label ?? "Sector";
            errors["sector"] = [$"{label} can't contain line breaks or hidden characters"];
        }

        foreach (var rule in Current.Fields.Where(f => f.Custom && !f.Hidden))
        {
            JsonElement element = default;
            var given = extra is not null && extra.TryGetValue(rule.Key, out element);
            var (value, problem) = given ? FromJson(rule, element) : (null, null);
            if (problem is not null)
            {
                errors[rule.Key] = [problem];
                continue;
            }
            values[rule.Key] = value;
            custom[rule.Key] = value;
        }

        foreach (var (key, problems) in Validate(values))
        {
            errors.TryAdd(key, problems);
        }
        return new RowInput(values, custom, errors);
    }

    // Turns a JSON value into the field's type, or says why it can't
    public static (object? Value, string? Problem) FromJson(FieldRule rule, JsonElement element)
    {
        if (element.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined) return (null, null);
        if (rule.Type == "text" && element.ValueKind is JsonValueKind.Object or JsonValueKind.Array)
        {
            return (null, $"{rule.Label} has to be text");
        }
        var text = element.ValueKind == JsonValueKind.String ? element.GetString() : element.GetRawText();
        if (string.IsNullOrWhiteSpace(text)) return (null, null);
        var (ok, value) = ConvertText(rule.Type, text);
        if (!ok) return (null, $"{rule.Label} has to be {(rule.Type == "number" ? "a number" : "a date")}");
        if (value is string stored)
        {
            stored = stored.Trim();
            if (stored.Length == 0) return (null, null);
            if (Names.HasHiddenCharacters(stored))
            {
                return (null, $"{rule.Label} can't contain line breaks or hidden characters");
            }
            return (stored, null);
        }
        return (value, null);
    }

    public static (bool Ok, object? Value) ConvertText(string type, string text) => type switch
    {
        "number" => decimal.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? (true, d) : (false, null),
        "date" => DateOnly.TryParseExact(text, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date) ? (true, date) : (false, null),
        _ => (true, text)
    };

    // How a custom value gets stored in the Extra JSON
    public static object? ToStored(object? value) => value is DateOnly date ? date.ToString("yyyy-MM-dd") : value;

    // Field key to its problems, the same shape ValidationProblem sends back
    public Dictionary<string, string[]> Validate(IReadOnlyDictionary<string, object?> values)
    {
        var errors = new Dictionary<string, string[]>();
        foreach (var rule in Current.Fields.Where(f => !f.Hidden))
        {
            values.TryGetValue(rule.Key, out var value);
            var problem = rule.Type switch
            {
                "text" => CheckText(rule, (value as string)?.Trim()),
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

    private static string? CheckText(FieldRule rule, string? text)
    {
        if (string.IsNullOrEmpty(text))
        {
            return rule.Required ? $"{rule.Label} is required" : null;
        }
        return rule.MaxLength is int max && text.Length > max ? $"{rule.Label} can be at most {max} characters" : null;
    }

    private static string? CheckNumber(FieldRule rule, decimal? number)
    {
        if (number is not decimal n)
        {
            return rule.Required ? $"{rule.Label} is required" : null;
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

    // Limits, labels and hiding custom fields change here. New fields come in through AddFieldAsync.
    // Fields never get removed, a custom field gets hidden instead so its data stays.
    public Dictionary<string, string[]> CheckNewRules(SaveRules body)
    {
        var errors = new Dictionary<string, string[]>();
        var incoming = body.Fields ?? [];
        if (incoming.Any(f => f is null || f.Key is null || f.Label is null))
        {
            errors["fields"] = ["Every field needs a key and a label"];
            return errors;
        }

        var current = Current.Fields.ToDictionary(f => f.Key);
        var noDuplicates = incoming.Select(f => f.Key).Distinct().Count() == incoming.Count;
        var everyKeyExists = incoming.All(f => current.ContainsKey(f.Key));

        // A page opened before a field was added sends a shorter list of keys that are all still real
        if (everyKeyExists && noDuplicates && incoming.Count < current.Count)
        {
            errors["fields"] = ["The fields changed since you opened this page. Reload and try again"];
            return errors;
        }

        if (incoming.Count != current.Count || !everyKeyExists || !noDuplicates)
        {
            errors["fields"] = ["Send every field once. Fields can't be removed, hide a custom field instead"];
            return errors;
        }

        var labels = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var field in incoming)
        {
            var was = current[field.Key];
            var problems = CheckLimits(field.Label, field.Type, field.MaxLength, field.Min, field.Max);
            if (field.Type != was.Type) problems.Add($"{was.Label} can't change type here, ask a developer from the Fields page");
            if (field.Custom != was.Custom) problems.Add("A field can't switch between built in and custom");
            if (field.Hidden && !was.Custom) problems.Add($"{was.Label} is built in, only custom fields can be hidden");
            if (field.Key == "name" && !field.Required) problems.Add("Name always has to be filled in");
            if (field.Key == "name" && field.MaxLength is not (>= 1 and <= Names.MaxLength))
                problems.Add("Name can be at most 200 characters");
            if (!labels.Add(field.Label?.Trim() ?? "")) problems.Add("Two fields can't have the same label");
            if (problems.Count > 0) errors[field.Key] = [.. problems];
        }
        return errors;
    }

    public Dictionary<string, string[]> CheckNewField(NewField field)
    {
        var problems = CheckLimits(field.Label, field.Type, field.MaxLength, field.Min, field.Max);
        if (field.Type is not ("text" or "number" or "date")) problems.Add("Type has to be text, number or date");
        if (Current.Fields.Any(f => string.Equals(f.Label, field.Label?.Trim(), StringComparison.OrdinalIgnoreCase)))
            problems.Add("A field with that label already exists");
        if (Current.Fields.Count(f => f.Custom) >= 30) problems.Add("There can be at most 30 custom fields");
        return problems.Count > 0 ? new() { ["field"] = [.. problems] } : [];
    }

    private static List<string> CheckLimits(string? label, string type, int? maxLength, decimal? min, decimal? max)
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

    public Task<RuleSet> AddFieldAsync(AppDbContext db, NewField field, string changedBy, CancellationToken ct)
    {
        var label = field.Label.Trim();
        var rule = new FieldRule(MakeKey(label), label, field.Type, field.Required, field.MaxLength, field.Min, field.Max, Custom: true);
        return SaveAsync(db, [.. Current.Fields, rule], $"Added the field {label}", changedBy, ct);
    }

    // Built in object names, and id/extra, so a custom field can't hide a real property
    private static readonly HashSet<string> ReservedKeys =
    [
        "constructor", "prototype", "proto", "tostring", "valueof", "hasownproperty",
        "isprototypeof", "propertyisenumerable", "tolocalestring", "id", "extra"
    ];

    // "Stock ticker" becomes "stock_ticker", with a number on the end if it's taken
    private string MakeKey(string label)
    {
        var slug = Regex.Replace(label.ToLowerInvariant(), "[^a-z0-9]+", "_").Trim('_');
        if (slug.Length == 0) slug = "field";
        if (ReservedKeys.Contains(slug)) slug += "_field";
        var key = slug;
        for (var n = 2; Current.Fields.Any(f => f.Key == key); n++) key = $"{slug}_{n}";
        return key;
    }

    // Saves a full copy of the table to the collector first, then the new rules.
    // If the copy fails this throws and the rules stay as they were.
    public async Task<RuleSet> SaveAsync(AppDbContext db, List<FieldRule> fields, string? note, string changedBy,
        CancellationToken ct, bool copyFirst = true)
    {
        await _saving.WaitAsync(ct);
        try
        {
            if (copyFirst)
            {
                await collector.SaveVersionAsync($"Before rules version {Current.Version + 1}", changedBy, ct);
            }

            var row = new RuleVersion
            {
                CreatedAt = DateTimeOffset.UtcNow,
                ChangedBy = changedBy,
                Note = string.IsNullOrWhiteSpace(note) ? null : note.Trim(),
                Fields = JsonSerializer.Serialize(fields.Select(f => f with { Label = f.Label.Trim() }), Json)
            };
            db.RuleVersions.Add(row);
            await db.SaveChangesAsync(ct);
            _current = ToRuleSet(row);
            return _current;
        }
        finally
        {
            _saving.Release();
        }
    }
}
