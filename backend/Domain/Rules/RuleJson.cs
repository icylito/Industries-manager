using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using api_v2.Domain.Entities;

namespace api_v2.Domain.Rules;

// How rules and custom field values turn into JSON and back. Pure: no database, no files.
public static class RuleJson
{
    public static readonly JsonSerializerOptions Json = JsonSerializerOptions.Web;

    public static List<FieldRule> ParseFields(string json) => JsonSerializer.Deserialize<List<FieldRule>>(json, Json)!;

    // For rules saved in old versions, which could have been edited by hand
    public static bool TryParseFields(string json, out List<FieldRule> fields)
    {
        fields = [];
        try
        {
            var read = JsonSerializer.Deserialize<List<FieldRule>>(json, Json);
            if (read is null || read.Any(f => f is null || string.IsNullOrWhiteSpace(f.Key)
                || string.IsNullOrWhiteSpace(f.Label) || string.IsNullOrWhiteSpace(f.Type))) return false;
            fields = read;
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    public static RuleSet ToRuleSet(RuleVersion row) => new(row.Id, row.CreatedAt, row.ChangedBy, row.Note, ParseFields(row.Fields));

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
}
