using System.Text.Json;
using api_v2.Domain.Entities;

namespace api_v2.Domain.Rules;

// Keeps the rules in use in memory, so every request reads the same set. Loading, saving and deleting
// versions is RulesAdminService; checking rows is FieldChecks and the JSON side is RuleJson.
public class RulesService
{
    public static readonly JsonSerializerOptions Json = RuleJson.Json;

    // One save at a time. The state is shared by every request, so the gate lives with it.
    internal readonly SemaphoreSlim Saving = new(1, 1);

    private RuleSet? _current;

    public RuleSet Current => _current ?? throw new InvalidOperationException("Rules aren't loaded yet");

    internal void SetCurrent(RuleSet rules) => _current = rules;

    // Reads a row from the page against the rules in use
    public RowInput Read(string? name, string? sector, decimal? price, DateOnly? release, Dictionary<string, JsonElement>? extra,
        string? currentSector = null, string? existingExtra = null) =>
        FieldChecks.Read(Current, name, sector, price, release, extra, currentSector, existingExtra);

    // Field key to its problems, in the shape ValidationProblem sends back
    public Dictionary<string, string[]> Validate(IReadOnlyDictionary<string, object?> values, string? currentSector = null) =>
        FieldChecks.Validate(Current, values, currentSector);

    public Dictionary<string, string[]> CheckNewRules(SaveRules body) => FieldChecks.CheckNewRules(Current, body);

    public Dictionary<string, string[]> CheckNewField(NewField field) => FieldChecks.CheckNewField(Current, field);

    public Dictionary<string, string[]> CheckNewFields(IReadOnlyList<NewField> fields) => FieldChecks.CheckNewFields(Current, fields);

    // True when old rules (from a saved version) don't match the rules in use
    public bool Differs(string? oldRulesJson) => oldRulesJson is null || !RuleJson.ParseFields(oldRulesJson).SequenceEqual(Current.Fields);

    // Static forwarding, so the callers that asked RulesService for these keep working unchanged
    public static RuleSet ToRuleSet(RuleVersion row) => RuleJson.ToRuleSet(row);

    public static List<FieldRule> ParseFields(string json) => RuleJson.ParseFields(json);

    public static bool TryParseFields(string json, out List<FieldRule> fields) => RuleJson.TryParseFields(json, out fields);

    public static (object? Value, string? Problem) FromJson(FieldRule rule, JsonElement element) => RuleJson.FromJson(rule, element);

    public static (bool Ok, object? Value) ConvertText(string type, string text) => RuleJson.ConvertText(type, text);

    public static object? ToStored(object? value) => RuleJson.ToStored(value);

    internal static List<string> CheckLimits(string? label, string type, int? maxLength, decimal? min, decimal? max) =>
        FieldChecks.CheckLimits(label, type, maxLength, min, max);

    public static string AddedNote(IReadOnlyList<string> labels) => FieldChecks.AddedNote(labels);

    internal static string MakeKey(string label, HashSet<string> taken) => FieldChecks.MakeKey(label, taken);

    internal static (string? Stored, string? Problem) CheckText(FieldRule rule, string? text, string? keep) =>
        FieldChecks.CheckText(rule, text, keep);

    internal static string? CheckNumber(FieldRule rule, decimal? number) => FieldChecks.CheckNumber(rule, number);
}
