using System.Globalization;
using System.Text.Json;
using api_v2.Data;
using api_v2.Model;
using Microsoft.EntityFrameworkCore;

namespace api_v2.Rules;

// Keeps the rules in use in memory and checks rows against them. The rules themselves live
// in the RuleVersions table, so changing a limit is a save, not a code change.
public class RulesService(CollectorStore collector)
{
    private static readonly JsonSerializerOptions Json = JsonSerializerOptions.Web;
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

    public static RuleSet ToRuleSet(RuleVersion row) => new(row.Id, row.CreatedAt, row.ChangedBy, row.Note,
        JsonSerializer.Deserialize<List<FieldRule>>(row.Fields, Json)!);

    // Field key to its problems, the same shape ValidationProblem sends back
    public Dictionary<string, string[]> Validate(IReadOnlyDictionary<string, object?> values)
    {
        var errors = new Dictionary<string, string[]>();
        foreach (var rule in Current.Fields)
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

    // Limits and labels can change here. Adding or removing fields comes with the Fields page (step 6).
    public Dictionary<string, string[]> CheckNewRules(SaveRules body)
    {
        var errors = new Dictionary<string, string[]>();
        var current = Current.Fields.ToDictionary(f => f.Key);
        var incoming = body.Fields ?? [];

        if (incoming.Count != current.Count || incoming.Any(f => !current.ContainsKey(f.Key)) ||
            incoming.Select(f => f.Key).Distinct().Count() != incoming.Count)
        {
            errors["fields"] = ["Send every field once. Adding or removing fields isn't possible here yet"];
            return errors;
        }

        foreach (var field in incoming)
        {
            var was = current[field.Key];
            var problems = new List<string>();
            if (field.Type != was.Type) problems.Add($"{was.Label} can't change type here");
            if (string.IsNullOrWhiteSpace(field.Label) || field.Label.Length > 40) problems.Add("The label has to be 1 to 40 characters");
            if (field.Key == "name" && !field.Required) problems.Add("Name always has to be filled in");
            if (field.MaxLength is not null && (field.Type != "text" || field.MaxLength is < 1 or > 1000))
                problems.Add("Max length only works on text and has to be 1 to 1000");
            if ((field.Min is not null || field.Max is not null) && field.Type != "number")
                problems.Add("Min and max only work on numbers");
            if (field.Min is decimal min && field.Max is decimal max && min > max)
                problems.Add("Min can't be above max");
            if (problems.Count > 0) errors[field.Key] = [.. problems];
        }
        return errors;
    }

    // Saves a full copy of the table to the collector first, then the new rules.
    // If the copy fails this throws and the rules stay as they were.
    public async Task<RuleSet> SaveAsync(AppDbContext db, SaveRules body, string changedBy, CancellationToken ct)
    {
        await _saving.WaitAsync(ct);
        try
        {
            var next = Current.Version + 1;
            await collector.SaveVersionAsync($"Before rules version {next}", changedBy, ct);

            var row = new RuleVersion
            {
                CreatedAt = DateTimeOffset.UtcNow,
                ChangedBy = changedBy,
                Note = string.IsNullOrWhiteSpace(body.Note) ? null : body.Note.Trim(),
                Fields = JsonSerializer.Serialize(body.Fields.Select(f => f with { Label = f.Label.Trim() }), Json)
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
