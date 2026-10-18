using System.Text;
using System.Text.Json;
using api_v2.Application.Auth;
using api_v2.Infrastructure.Security;
using api_v2.Application.Health;
using api_v2.Application.Hosted;
using api_v2.Application.Settings;
using api_v2.Application.Startup;
using api_v2.Infrastructure.Configuration;
using api_v2.Infrastructure.Export;
using api_v2.Infrastructure.Files;
using api_v2.Infrastructure.Persistence;
using api_v2.Domain.Rules;

namespace api_v2.Presentation.Endpoints;

// What Export settings writes and Import settings reads. Retention and the rules for the fields that exist.
public record SettingsFile(string? App, int? Format, DateTimeOffset? ExportedAt, Retention? Retention, List<FieldRule>? Fields);

public static class SettingsFileEndpoints
{
    private const string AppName = "stock-listing";

    // Called from MapHistory, so these live in the same group (admin only, history has to be up)
    public static void MapSettingsFile(this RouteGroupBuilder history)
    {
        // The settings as a file the team can keep or move to another copy of the app
        history.MapGet("/settings/export", (RulesService rules, SettingsService settings) =>
        {
            var file = new SettingsFile(AppName, 1, DateTimeOffset.UtcNow, settings.Retention, rules.Current.Fields.ToList());
            var bytes = JsonSerializer.SerializeToUtf8Bytes(file, new JsonSerializerOptions(RulesService.Json) { WriteIndented = true });
            return Results.File(bytes, "application/json", $"settings-{DateTime.UtcNow:yyyy-MM-dd}.json");
        });

        // What importing this file would change, nothing is saved
        history.MapPost("/settings/import/preview", async (SettingsFile? body, AppDbContext db, RulesService rules,
            SettingsService settings, CollectorStore collector, AppLocks locks, CancellationToken ct) =>
        {
            await using var rulesLock = await locks.TakeAsync(AppLock.Rules, ct);
            await rules.LoadAsync(db, ct);
            var plan = Plan(body, rules, settings);
            if (plan.Problem is not null) return plan.Problem;

            var willRemove = plan.Retention is { } r && plan.RetentionChanged ? await collector.CountRemovableAsync(r, plan.RulesChanged ? 1 : 0, ct) : 0;
            return Results.Ok(new
            {
                plan.RulesChanged,
                plan.RetentionChanged,
                plan.Retention,
                plan.Ignored,
                WillRemove = willRemove
            });
        });

        // Applies the file. The table is copied first, like any rules change, so it can be undone from History.
        history.MapPost("/settings/import", async (SettingsFile? body, AppDbContext db, RulesService rules,
            SettingsService settings, CollectorStore collector, ICurrentUser user, AppLocks locks,
            ILogger<RulesService> log, CancellationToken ct) =>
        {
            await using var rulesLock = await locks.TakeAsync(AppLock.Rules, ct);
            await using var settingsLock = await locks.TakeAsync(AppLock.Settings, ct);
            await rules.LoadAsync(db, ct);
            var plan = Plan(body, rules, settings);
            if (plan.Problem is not null) return plan.Problem;

            if (plan.RulesChanged)
            {
                try
                {
                    await rules.SaveAsync(db, plan.Fields, "Imported settings from a file", user.Name, ct);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    log.LogError(ex, "Importing settings failed");
                    return Results.Problem("Couldn't save a copy of the table first, so nothing was imported. Try again in a moment",
                        statusCode: StatusCodes.Status503ServiceUnavailable, title: "Backup not available");
                }
            }

            int? removed = null;
            if (plan.Retention is { } retention && plan.RetentionChanged)
            {
                await settings.SaveRetentionAsync(db, retention, user.Name, ct);
                try
                {
                    removed = await collector.ApplyRetentionAsync(ct);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    log.LogWarning(ex, "Retention was saved but old versions weren't removed");
                }
            }

            return Results.Ok(new { plan.RulesChanged, plan.RetentionChanged, plan.Ignored, Removed = removed ?? 0 });
        });
    }

    private record ImportPlan(IResult? Problem, List<FieldRule> Fields, bool RulesChanged, Retention? Retention,
        bool RetentionChanged, List<string> Ignored);

    // Checks the file and works out what it would change. Fields that don't exist here are ignored and named.
    private static ImportPlan Plan(SettingsFile? file, RulesService rules, SettingsService settings)
    {
        ImportPlan Refuse(IResult problem) => new(problem, [], false, null, false, []);

        if (file is null || file.App != AppName)
        {
            return Refuse(Results.BadRequest("That isn't a settings file from this app. Use a file made with Export settings"));
        }
        if (file.Retention is null && file.Fields is null)
        {
            return Refuse(Results.BadRequest("That file has no settings in it"));
        }

        var retentionChanged = false;
        if (file.Retention is { } retention)
        {
            var errors = SettingsService.Check(retention);
            if (errors.Count > 0) return Refuse(Results.ValidationProblem(errors));
            retentionChanged = retention != settings.Retention;
        }

        var ignored = new List<string>();
        var merged = rules.Current.Fields.ToList();
        if (file.Fields is { } incoming)
        {
            if (incoming.Any(f => f is null || f.Key is null || f.Label is null))
            {
                return Refuse(Results.BadRequest("Every field in the file needs a key and a label"));
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
            if (errors.Count > 0) return Refuse(Results.ValidationProblem(errors));
        }

        return new ImportPlan(null, merged, rulesChanged, file.Retention, retentionChanged, ignored);
    }
}
