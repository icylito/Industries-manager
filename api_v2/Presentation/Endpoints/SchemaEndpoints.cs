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
using Microsoft.EntityFrameworkCore;

namespace api_v2.Presentation.Endpoints;

public static class SchemaEndpoints
{
    public static void MapSchema(this WebApplication app)
    {
        var schema = app.MapGroup("/schema").RequireDatabaseReady();

        // The rules in use, the page builds its limits and rule chips from this
        schema.MapGet("/", (RulesService rules) => Results.Ok(rules.Current)).RequireViewer();

        // Every rules version, newest first
        schema.MapGet("/versions", async (AppDbContext db) =>
        {
            var rows = await db.RuleVersions.OrderByDescending(r => r.Id).ToListAsync();
            return Results.Ok(rows.Select(RulesService.ToRuleSet));
        }).RequireSignIn();

        // Saves new rules as the next version, a full copy of the table goes to the collector first
        schema.MapPut("/", async (SaveRules body, AppDbContext db, RulesService rules, ICurrentUser user,
            ILogger<RulesService> log, AppLocks locks, CancellationToken ct) =>
        {
            await using var rulesLock = await locks.TakeAsync(AppLock.Rules, ct);
            await rules.LoadAsync(db, ct);
            if (body.BasedOn is not int v) return NoBasedOn();
            if (v != rules.Current.Version)
            {
                return Results.Conflict(
                    "Someone changed the fields since you opened this page. Reload to see their changes, then save again");
            }
            var errors = rules.CheckNewRules(body);
            if (errors.Count > 0)
            {
                return Results.ValidationProblem(errors);
            }

            try
            {
                // The page can send options, but only config.toml changes them
                var current = rules.Current.Fields.ToDictionary(f => f.Key);
                var fields = body.Fields.Select(f =>
                    current.TryGetValue(f.Key, out var was) ? f with { Options = was.Options } : f).ToList();
                return Results.Ok(await rules.SaveAsync(db, fields, body.Note, user.Name, ct));
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogError(ex, "Saving new rules failed");
                return Results.Problem("Couldn't save a copy of the table first, so the rules didn't change. Try again in a moment",
                    statusCode: StatusCodes.Status503ServiceUnavailable, title: "Backup not available");
            }
        }).RequireAdmin();

        // Adds a custom field, its values live in each row's Extra JSON so no C# or migration is needed
        schema.MapPost("/fields", async (NewField body, AppDbContext db, RulesService rules, ICurrentUser user,
            ILogger<RulesService> log, AppLocks locks, CancellationToken ct) =>
        {
            await using var rulesLock = await locks.TakeAsync(AppLock.Rules, ct);
            await rules.LoadAsync(db, ct);
            var errors = rules.CheckNewField(body);
            if (errors.Count > 0)
            {
                return Results.ValidationProblem(errors);
            }

            try
            {
                return Results.Ok(await rules.AddFieldAsync(db, body, user.Name, ct));
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogError(ex, "Adding a field failed");
                return Results.Problem("Couldn't save a copy of the table first, so the field wasn't added. Try again in a moment",
                    statusCode: StatusCodes.Status503ServiceUnavailable, title: "Backup not available");
            }
        }).RequireAdmin();

        // Several custom fields in one rules version and one table copy
        schema.MapPost("/fields/many", async (NewFields body, AppDbContext db, RulesService rules, ICurrentUser user,
            ILogger<RulesService> log, AppLocks locks, CancellationToken ct) =>
        {
            if (body.Fields is null || body.Fields.Count == 0)
            {
                return Results.BadRequest("Add at least one field first");
            }

            await using var rulesLock = await locks.TakeAsync(AppLock.Rules, ct);
            await rules.LoadAsync(db, ct);
            if (body.BasedOn is not int v) return NoBasedOn();
            if (v != rules.Current.Version)
            {
                return Results.Conflict(
                    "Someone changed the fields since you opened this page. Reload to see their changes, then save again");
            }

            var errors = rules.CheckNewFields(body.Fields);
            if (errors.Count > 0)
            {
                return Results.ValidationProblem(errors);
            }

            try
            {
                return Results.Ok(await rules.AddFieldsAsync(db, body.Fields, user.Name, ct));
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogError(ex, "Adding fields failed");
                return Results.Problem("Couldn't save a copy of the table first, so the field wasn't added. Try again in a moment",
                    statusCode: StatusCodes.Status503ServiceUnavailable, title: "Backup not available");
            }
        }).RequireAdmin();

        // Removes a field the page added. Built in fields stay. A copy of the table is saved first.
        schema.MapDelete("/fields/{key}", async (string key, int? basedOn, AppDbContext db, RulesService rules,
            CollectorStore collector, ICurrentUser user, ILogger<RulesService> log, AppLocks locks, CancellationToken ct) =>
        {
            await using var tableLock = await locks.TakeAsync(AppLock.Table, ct);
            await using var rulesLock = await locks.TakeAsync(AppLock.Rules, ct);
            await rules.LoadAsync(db, ct);

            var field = rules.Current.Fields.FirstOrDefault(f => f.Key == key);
            if (field is null)
            {
                return Results.NotFound($"There's no field {key}");
            }
            if (!field.Custom)
            {
                return Results.BadRequest($"{field.Label} is built in, only a developer can remove it");
            }
            if (basedOn is not int v) return NoBasedOn();
            if (v != rules.Current.Version)
            {
                return Results.Conflict(
                    "Someone changed the fields since you opened this page. Reload to see their changes, then save again");
            }

            try
            {
                await collector.SaveVersionAsync($"Before deleting the field {field.Label}", user.Name, ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogError(ex, "Copy before deleting a field failed");
                return Results.Problem(
                    "Couldn't save a copy of the table first, so the field wasn't deleted. Try again in a moment",
                    statusCode: StatusCodes.Status503ServiceUnavailable, title: "Backup not available");
            }

            return Results.Ok(await rules.DeleteFieldAsync(db, field.Key, field.Label, user.Name, ct));
        }).RequireAdmin();
    }

    // Without the version the page was looking at, two admins saving at once would quietly undo each other
    private static IResult NoBasedOn() => Results.ValidationProblem(new Dictionary<string, string[]>
    {
        ["basedOn"] = ["Reload the Fields page and try again"]
    });

    // While migrations run or after they fail, answer 503 instead of hitting a half ready database
    public static RouteGroupBuilder RequireDatabaseReady(this RouteGroupBuilder group) =>
        group.AddEndpointFilter(async (context, next) =>
        {
            var status = context.HttpContext.RequestServices.GetRequiredService<DatabaseStatus>();
            if (status.State != DatabaseState.Ready)
            {
                return Results.Problem(status.Message, statusCode: StatusCodes.Status503ServiceUnavailable,
                    title: "Database not ready");
            }
            return await next(context);
        });
}
