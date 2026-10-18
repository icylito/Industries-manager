using System.Text.Json;
using api_v2.Application.Ports;
using api_v2.Domain.Entities;
using api_v2.Domain.Rules;

namespace api_v2.Application.Rules;

// Loads the rules, saves new versions, adds and deletes custom fields, and picks up the sector list.
// The current set stays in the singleton RulesService so every request reads the same rules.
public class RulesAdminService(IRulesStore store, ICollectorStore collector, ISectorConfig sectorConfig,
    RulesService rules, ILogger<RulesAdminService> log)
{
    // Runs on startup after migrations. A fresh database gets version 1 with the starting limits.
    public async Task LoadAsync(CancellationToken ct)
    {
        var latest = await store.LatestAsync(ct);
        if (latest is null)
        {
            var row = new RuleVersion
            {
                CreatedAt = DateTimeOffset.UtcNow,
                ChangedBy = "system",
                Note = "Starting rules",
                Fields = JsonSerializer.Serialize(DefaultRules.Industries, RuleJson.Json)
            };
            latest = await store.InsertVersionAsync(row, ct);
        }
        rules.SetCurrent(RuleJson.ToRuleSet(latest));
    }

    // After the rules load, copy the sector list from scripts/config.toml when it differs.
    // An empty list (sectors = []) clears the list, so the sector is free text. A missing or broken file
    // keeps the rules that are already loaded and never stops startup.
    public async Task SyncSectorsAsync(CancellationToken ct)
    {
        try
        {
            var text = await sectorConfig.ReadTextAsync(ct);
            if (text is null) return;

            if (!SectorList.TryRead(text, out var sectors, out var problem))
            {
                log.LogWarning("Sector list was skipped ({Problem}), keeping the current rules", problem);
                return;
            }
            var fields = rules.Current.Fields.ToList();
            var index = fields.FindIndex(f => f.Key == "sector");
            if (index < 0)
            {
                log.LogWarning("There's no sector field, so the sector list was skipped");
                return;
            }
            if (FieldRule.SameOptions(fields[index].Options, sectors)) return;

            fields[index] = fields[index] with { Options = sectors.Count == 0 ? null : sectors };
            await SaveAsync(fields, "Sector list from config.toml", "system", ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "Sector list was not applied, keeping the current rules");
        }
    }

    public Task<RuleSet> AddFieldAsync(NewField field, string changedBy, CancellationToken ct) =>
        AddFieldsAsync([field], changedBy, ct);

    // One rules version and one table copy for the whole batch.
    public async Task<RuleSet> AddFieldsAsync(IReadOnlyList<NewField> fields, string changedBy, CancellationToken ct)
    {
        var taken = await UsedKeysAsync(ct);
        var labels = new List<string>();
        var added = new List<FieldRule>();
        foreach (var field in fields)
        {
            var label = field.Label.Trim();
            labels.Add(label);
            var key = FieldChecks.MakeKey(label, taken);
            added.Add(new FieldRule(key, label, field.Type, field.Required, field.MaxLength, field.Min, field.Max, Custom: true));
        }
        return await SaveAsync([.. rules.Current.Fields, .. added], FieldChecks.AddedNote(labels), changedBy, ct);
    }

    // Removes a custom field, its values, and closes requests that were waiting on it. The caller saved a table copy first.
    // Says how many rows lost a value and how many open requests were closed, so the page can say what happened.
    public async Task<FieldDeleted> DeleteFieldAsync(string key, string label, string changedBy, CancellationToken ct)
    {
        // A copy of the table goes first, so the values the field carried can be brought back
        await collector.SaveVersionAsync($"Before deleting the field {label}", changedBy, ct);
        var kept = rules.Current.Fields.Where(f => f.Key != key).ToList();
        try
        {
            var (saved, rowsChanged, requestsClosed) = await store.DeleteFieldAsync(key, label, kept, changedBy, ct);
            rules.SetCurrent(saved);
            return new FieldDeleted(saved, rowsChanged, requestsClosed);
        }
        catch
        {
            // The rules in memory may be a version behind the database after a failed delete
            try
            {
                var latest = await store.LatestAsync(ct);
                if (latest is not null) rules.SetCurrent(RuleJson.ToRuleSet(latest));
            }
            catch (Exception ex)
            {
                log.LogWarning(ex, "Reloading the rules after a failed delete failed");
            }
            throw;
        }
    }

    // Saves a full copy of the table to the collector first, then the new rules.
    // If the copy fails this throws and the rules stay as they were.
    public async Task<RuleSet> SaveAsync(List<FieldRule> fields, string? note, string changedBy,
        CancellationToken ct, bool copyFirst = true)
    {
        await rules.Saving.WaitAsync(ct);
        try
        {
            if (copyFirst)
            {
                await collector.SaveVersionAsync($"Before rules version {rules.Current.Version + 1}", changedBy, ct);
            }

            var row = new RuleVersion
            {
                CreatedAt = DateTimeOffset.UtcNow,
                ChangedBy = changedBy,
                Note = string.IsNullOrWhiteSpace(note) ? null : note.Trim(),
                Fields = JsonSerializer.Serialize(fields.Select(f => f with { Label = f.Label.Trim() }), RuleJson.Json)
            };
            row = await store.InsertVersionAsync(row, ct);
            var saved = RuleJson.ToRuleSet(row);
            rules.SetCurrent(saved);
            return saved;
        }
        finally
        {
            rules.Saving.Release();
        }
    }

    // Keys from every rules version, so a deleted field can't come back under the same key
    private async Task<HashSet<string>> UsedKeysAsync(CancellationToken ct)
    {
        var used = new HashSet<string>(StringComparer.Ordinal);
        foreach (var json in await store.FieldsJsonAsync(ct))
        {
            try
            {
                foreach (var field in RuleJson.ParseFields(json)) used.Add(field.Key);
            }
            catch (JsonException)
            {
                // A rules row that can't be read doesn't block adding a field
            }
        }
        foreach (var field in rules.Current.Fields) used.Add(field.Key);
        return used;
    }
}
