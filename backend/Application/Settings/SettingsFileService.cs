using api_v2.Application.Ports;
using api_v2.Application.Rules;
using api_v2.Domain.Collector;
using api_v2.Domain.Rules;

namespace api_v2.Application.Settings;

// What a settings file holds once it is read, whatever the file looked like
public sealed record SettingsImport(string? App, Retention? Retention, List<FieldRule>? Fields);

public abstract record SettingsImportResult
{
    public sealed record Refused(string Message) : SettingsImportResult;
    public sealed record Invalid(Dictionary<string, string[]> Errors) : SettingsImportResult;
    public sealed record CopyFailed : SettingsImportResult;
    public sealed record Previewed(bool RulesChanged, bool RetentionChanged, Retention? Retention, List<string> Ignored,
        int WillRemove) : SettingsImportResult;
    public sealed record Imported(bool RulesChanged, bool RetentionChanged, List<string> Ignored, int Removed) : SettingsImportResult;
}

// The settings as a file the team can keep or move to another copy of the app: the field labels and limits, and
// how long History keeps versions. Importing copies the table first, like any rules change, so it can be undone.
public sealed class SettingsFileService(RulesAdminService admin, RulesService rules, SettingsService settings, ISettingsStore store,
    ICollectorStore collector, IAppLocks locks, ILogger<RulesService> log)
{
    public const string AppName = "stock-listing";

    // What importing this file would change, nothing is saved
    public async Task<SettingsImportResult> PreviewAsync(SettingsImport file, CancellationToken ct)
    {
        await using var rulesLock = await locks.TakeAsync(AppLock.Rules, ct);
        await admin.LoadAsync(ct);
        var plan = Plan(file);
        if (plan.Problem is not null) return plan.Problem;

        var willRemove = plan.Retention is { } r && plan.RetentionChanged
            ? await collector.CountRemovableAsync(r, plan.RulesChanged ? 1 : 0, ct)
            : 0;
        return new SettingsImportResult.Previewed(plan.RulesChanged, plan.RetentionChanged, plan.Retention, plan.Ignored, willRemove);
    }

    public async Task<SettingsImportResult> ImportAsync(SettingsImport file, string changedBy, CancellationToken ct)
    {
        await using var rulesLock = await locks.TakeAsync(AppLock.Rules, ct);
        await using var settingsLock = await locks.TakeAsync(AppLock.Settings, ct);
        await admin.LoadAsync(ct);
        var plan = Plan(file);
        if (plan.Problem is not null) return plan.Problem;

        if (plan.RulesChanged)
        {
            try
            {
                await admin.SaveAsync(plan.Fields, "Imported settings from a file", changedBy, ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogError(ex, "Importing settings failed");
                return new SettingsImportResult.CopyFailed();
            }
        }

        int? removed = null;
        if (plan.Retention is { } retention && plan.RetentionChanged)
        {
            await settings.SaveRetentionAsync(store, retention, changedBy, ct);
            try
            {
                removed = await collector.ApplyRetentionAsync(ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogWarning(ex, "Retention was saved but old versions weren't removed");
            }
        }
        return new SettingsImportResult.Imported(plan.RulesChanged, plan.RetentionChanged, plan.Ignored, removed ?? 0);
    }

    private sealed record ImportPlan(SettingsImportResult? Problem, List<FieldRule> Fields, bool RulesChanged, Retention? Retention,
        bool RetentionChanged, List<string> Ignored);

    // Checks the file and works out what it would change. Fields that don't exist here are ignored and named.
    private ImportPlan Plan(SettingsImport file)
    {
        ImportPlan Refuse(SettingsImportResult problem) => new(problem, [], false, null, false, []);

        if (file.App != AppName)
        {
            return Refuse(new SettingsImportResult.Refused("That isn't a settings file from this app. Use a file made with Export settings"));
        }
        if (file.Retention is null && file.Fields is null)
        {
            return Refuse(new SettingsImportResult.Refused("That file has no settings in it"));
        }

        var retentionChanged = false;
        if (file.Retention is { } retention)
        {
            var errors = SettingsService.Check(retention);
            if (errors.Count > 0) return Refuse(new SettingsImportResult.Invalid(errors));
            retentionChanged = retention != settings.Retention;
        }

        var ignored = new List<string>();
        var merged = rules.Current.Fields.ToList();
        if (file.Fields is { } incoming)
        {
            if (incoming.Any(f => f is null || f.Key is null || f.Label is null))
            {
                return Refuse(new SettingsImportResult.Refused("Every field in the file needs a key and a label"));
            }
            var byKey = incoming.GroupBy(f => f.Key).ToDictionary(g => g.Key, g => g.First());
            for (var i = 0; i < merged.Count; i++)
            {
                var now = merged[i];
                if (!byKey.TryGetValue(now.Key, out var wanted)) continue;
                // Labels and limits come from the file. The type, whether it is built in, and the sector list stay as they are here.
                merged[i] = now with
                {
                    Label = wanted.Label,
                    Required = wanted.Required,
                    MaxLength = wanted.MaxLength,
                    Min = wanted.Min,
                    Max = wanted.Max,
                    Hidden = now.Custom && wanted.Hidden
                };
            }
            ignored = incoming.Select(f => f.Key).Distinct().Where(k => merged.All(m => m.Key != k)).ToList();
        }

        var rulesChanged = !merged.SequenceEqual(rules.Current.Fields);
        if (rulesChanged)
        {
            var errors = rules.CheckNewRules(new SaveRules(null, merged, rules.Current.Version));
            if (errors.Count > 0) return Refuse(new SettingsImportResult.Invalid(errors));
        }

        return new ImportPlan(null, merged, rulesChanged, file.Retention, retentionChanged, ignored);
    }
}
