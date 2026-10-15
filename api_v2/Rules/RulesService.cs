using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using api_v2.Data;
using api_v2.Model;
using Microsoft.EntityFrameworkCore;

namespace api_v2.Rules;

// What a row from the page turns into after reading its fields against the rules
public record RowInput(Dictionary<string, object?> Values, Dictionary<string, object?> Custom, Dictionary<string, string[]> Errors);

// Keeps the rules in use in memory and checks rows against them. The rules themselves live
// in the RuleVersions table, so changing a limit is a save, not a code change.
public class RulesService(CollectorStore collector, IConfiguration config, IWebHostEnvironment env, ILogger<RulesService> log)
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

    // After the rules load, copy the sector list from scripts/config.toml when it differs.
    // An empty list (sectors = []) clears the list, so the sector is free text. A missing or broken file
    // keeps the rules that are already loaded and never stops startup.
    public async Task SyncSectorsAsync(AppDbContext db, CancellationToken ct)
    {
        try
        {
            var configured = config["Rules:ConfigToml"];
            var path = string.IsNullOrWhiteSpace(configured)
                ? Path.GetFullPath(Path.Combine(env.ContentRootPath, "..", "scripts", "config.toml"))
                : configured;
            if (!File.Exists(path))
            {
                log.LogWarning("No sector list at {Path}, keeping the current rules", path);
                return;
            }

            string text;
            try
            {
                text = await File.ReadAllTextAsync(path, ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogWarning(ex, "Couldn't read the sector list at {Path}, keeping the current rules", path);
                return;
            }

            if (!SectorList.TryRead(text, out var sectors, out var problem))
            {
                log.LogWarning("Sector list at {Path} was skipped ({Problem}), keeping the current rules", path, problem);
                return;
            }
            var fields = Current.Fields.ToList();
            var index = fields.FindIndex(f => f.Key == "sector");
            if (index < 0)
            {
                log.LogWarning("There's no sector field, so the list in {Path} was skipped", path);
                return;
            }
            if (FieldRule.SameOptions(fields[index].Options, sectors)) return;

            fields[index] = fields[index] with { Options = sectors.Count == 0 ? null : sectors };
            await SaveAsync(db, fields, "Sector list from config.toml", "system", ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "Sector list was not applied, keeping the current rules");
        }
    }

    public static RuleSet ToRuleSet(RuleVersion row) => new(row.Id, row.CreatedAt, row.ChangedBy, row.Note, ParseFields(row.Fields));

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

    // True when old rules (from a saved version) don't match the rules in use
    public bool Differs(string? oldRulesJson)
    {
        if (oldRulesJson is null) return true;
        return !ParseFields(oldRulesJson).SequenceEqual(Current.Fields);
    }

    // Reads a row from the page: the 4 built in fields plus the custom ones in Extra.
    // currentSector is the sector already stored on the row. An edit may keep that value even when it isn't in the list.
    // existingExtra is the row's stored custom values. A custom field the caller didn't send keeps its stored value.
    public RowInput Read(string? name, string? sector, decimal? price, DateOnly? release, Dictionary<string, JsonElement>? extra,
        string? currentSector = null, string? existingExtra = null)
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
            var label = Current.Fields.FirstOrDefault(f => f.Key == "sector")?.Label ?? "Sector";
            errors["sector"] = [$"{label} can't contain line breaks or hidden characters"];
        }

        foreach (var rule in Current.Fields.Where(f => f.Custom && !f.Hidden))
        {
            JsonElement element = default;
            var given = extra is not null && extra.TryGetValue(rule.Key, out element);
            if (!given)
            {
                // Not sent, so the stored value stays as it is. It still counts for the checks (Required, limits).
                object? stored = null;
                if (kept is not null && kept.TryGetPropertyValue(rule.Key, out var node) && node is not null)
                {
                    stored = FromJson(rule, JsonDocument.Parse(node.ToJsonString()).RootElement).Value;
                }
                values[rule.Key] = stored;
                continue;
            }
            var (value, problem) = FromJson(rule, element);
            if (problem is not null)
            {
                errors[rule.Key] = [problem];
                continue;
            }
            values[rule.Key] = value;
            custom[rule.Key] = value;
        }

        // A matching choice is stored with the spelling from the list ("private sector" becomes "Private Sector")
        foreach (var rule in Current.Fields.Where(f => !f.Hidden && f.Type == "text" && f.Options is { Count: > 0 }))
        {
            var keep = rule.Key == "sector" ? currentSector : null;
            var (stored, problem) = CheckText(rule, values.GetValueOrDefault(rule.Key) as string, keep);
            if (problem is null) values[rule.Key] = stored;
        }

        foreach (var (key, problems) in Validate(values, currentSector))
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
    public Dictionary<string, string[]> Validate(IReadOnlyDictionary<string, object?> values, string? currentSector = null)
    {
        var errors = new Dictionary<string, string[]>();
        foreach (var rule in Current.Fields.Where(f => !f.Hidden))
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
    internal static (string? Stored, string? Problem) CheckText(FieldRule rule, string? text, string? keep)
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

    private const int DefaultCustomTextMax = 1000;
    private const int MaxDecimals = 4;

    // Digits after the decimal point, not counting trailing zeros
    private static int Decimals(decimal d) => (decimal.GetBits(d / 1.0000000000000000000000000000m)[3] >> 16) & 0xFF;

    internal static string? CheckNumber(FieldRule rule, decimal? number)
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

        // Labels are names: two are the same when their keys match (Names.Key)
        var labels = new HashSet<string>();
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
            if (!string.IsNullOrWhiteSpace(field.Label) && Names.HasNoLetters(field.Label)) problems.Add(Names.NoKeyMessage);
            else if (!labels.Add(Names.Key(field.Label))) problems.Add("Two fields can't have the same label");
            if (problems.Count > 0) errors[field.Key] = [.. problems];
        }
        return errors;
    }

    public Dictionary<string, string[]> CheckNewField(NewField field)
    {
        var errors = CheckNewFields([field]);
        return errors.Count > 0 ? new() { ["field"] = errors["fields[0]"] } : [];
    }

    // One problem list per field, keyed fields[0], fields[1], ... Nothing is saved unless every field is fine.
    public Dictionary<string, string[]> CheckNewFields(IReadOnlyList<NewField> fields)
    {
        var errors = new Dictionary<string, string[]>();
        var seen = new HashSet<string>();
        var custom = Current.Fields.Count(f => f.Custom);
        for (var i = 0; i < fields.Count; i++)
        {
            var field = fields[i];
            var problems = CheckLimits(field.Label, field.Type, field.MaxLength, field.Min, field.Max);
            if (field.Type is not ("text" or "number" or "date")) problems.Add("Type has to be text, number or date");
            var label = field.Label?.Trim() ?? "";
            var key = Names.Key(label);
            if (label.Length > 0 && Names.HasNoLetters(label))
                problems.Add(Names.NoKeyMessage);
            else if (label.Length > 0 && Current.Fields.Any(f => Names.Key(f.Label) == key))
                problems.Add("A field with that label already exists");
            else if (label.Length > 0 && !seen.Add(key))
                problems.Add("A field with that label already exists");
            if (custom + i + 1 > 30) problems.Add("There can be at most 30 custom fields");
            if (problems.Count > 0) errors[$"fields[{i}]"] = [.. problems];
        }
        return errors;
    }

    internal static List<string> CheckLimits(string? label, string type, int? maxLength, decimal? min, decimal? max)
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

    public Task<RuleSet> AddFieldAsync(AppDbContext db, NewField field, string changedBy, CancellationToken ct) =>
        AddFieldsAsync(db, [field], changedBy, ct);

    // One rules version and one table copy for the whole batch.
    public async Task<RuleSet> AddFieldsAsync(AppDbContext db, IReadOnlyList<NewField> fields, string changedBy, CancellationToken ct)
    {
        var taken = await UsedKeysAsync(db, ct);
        var labels = new List<string>();
        var added = new List<FieldRule>();
        foreach (var field in fields)
        {
            var label = field.Label.Trim();
            labels.Add(label);
            var key = MakeKey(label, taken);
            added.Add(new FieldRule(key, label, field.Type, field.Required, field.MaxLength, field.Min, field.Max, Custom: true));
        }
        return await SaveAsync(db, [.. Current.Fields, .. added], AddedNote(labels), changedBy, ct);
    }

    // "Added the field A", "Added the fields A and B", "Added the fields A, B and C"
    public static string AddedNote(IReadOnlyList<string> labels)
    {
        if (labels.Count <= 1) return $"Added the field {labels.FirstOrDefault()}";
        if (labels.Count == 2) return $"Added the fields {labels[0]} and {labels[1]}";
        return $"Added the fields {string.Join(", ", labels.Take(labels.Count - 1))} and {labels[^1]}";
    }

    // Removes a custom field, its values, and closes requests that were waiting on it. The caller saved a table copy first.
    // Says how many rows lost a value and how many open requests were closed, so the page can say what happened.
    public async Task<FieldDeleted> DeleteFieldAsync(AppDbContext db, string key, string label, string changedBy, CancellationToken ct)
    {
        var strategy = db.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
            await using var tx = await db.Database.BeginTransactionAsync(ct);
            try
            {
                var rowsChanged = await db.Database.ExecuteSqlInterpolatedAsync($$"""
                    UPDATE "Industries"
                    SET "Extra" = NULLIF("Extra" - {{key}}, '{}'::jsonb)
                    WHERE jsonb_exists("Extra", {{key}})
                    """, ct);

                await db.Database.ExecuteSqlInterpolatedAsync($"""
                    UPDATE "Industries"
                    SET "LostFields" = CASE
                        WHEN cardinality(array_remove("LostFields", {key})) = 0 THEN NULL
                        ELSE array_remove("LostFields", {key})
                    END
                    WHERE {key} = ANY("LostFields")
                    """, ct);

                var open = await db.Requests.Where(r => (r.Status == "open" || r.Status == "in-progress") && r.FieldKey == key).ToListAsync(ct);
                var now = DateTimeOffset.UtcNow;
                const string line = "The field was deleted, so this was closed by itself.";
                foreach (var request in open)
                {
                    request.Status = "dismissed";
                    request.ResolvedAt = now;
                    request.ResolvedBy = "system";
                    request.Details = string.IsNullOrWhiteSpace(request.Details) ? line : request.Details.TrimEnd() + "\n" + line;
                }

                var kept = Current.Fields.Where(f => f.Key != key).ToList();
                var saved = await SaveAsync(db, kept, $"Deleted the field {label}", changedBy, ct, copyFirst: false);
                await tx.CommitAsync(ct);
                return new FieldDeleted(saved, rowsChanged, open.Count);
            }
            catch
            {
                try
                {
                    await tx.RollbackAsync(CancellationToken.None);
                }
                catch (Exception ex)
                {
                    log.LogWarning(ex, "Rolling back the field delete failed");
                }
                db.ChangeTracker.Clear();
                try
                {
                    await LoadAsync(db, CancellationToken.None);
                }
                catch (Exception ex)
                {
                    log.LogWarning(ex, "Reloading the rules after a failed delete failed");
                }
                throw;
            }
        });
    }

    // Built in object names, and id/extra, so a custom field can't hide a real property
    private static readonly HashSet<string> ReservedKeys =
    [
        "constructor", "prototype", "proto", "tostring", "valueof", "hasownproperty",
        "isprototypeof", "propertyisenumerable", "tolocalestring", "id", "extra"
    ];

    // Keys from every rules version, so a deleted field can't come back under the same key
    private async Task<HashSet<string>> UsedKeysAsync(AppDbContext db, CancellationToken ct)
    {
        var used = new HashSet<string>(StringComparer.Ordinal);
        var rows = await db.RuleVersions.AsNoTracking().Select(r => r.Fields).ToListAsync(ct);
        foreach (var json in rows)
        {
            try
            {
                foreach (var field in ParseFields(json)) used.Add(field.Key);
            }
            catch (JsonException)
            {
                // A rules row that can't be read doesn't block adding a field
            }
        }
        foreach (var field in Current.Fields) used.Add(field.Key);
        return used;
    }

    // "Stock ticker" becomes "stock_ticker", with a number on the end if it's taken. Letters from other languages stay.
    // taken includes keys already handed out in this batch, so two similar labels don't collide.
    internal static string MakeKey(string label, HashSet<string> taken)
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
