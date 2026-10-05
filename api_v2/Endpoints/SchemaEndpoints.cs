using api_v2.Auth;
using api_v2.Data;
using api_v2.Rules;
using Microsoft.EntityFrameworkCore;

namespace api_v2.Endpoints;

public static class SchemaEndpoints
{
    public static void MapSchema(this WebApplication app)
    {
        var schema = app.MapGroup("/schema").RequireDatabaseReady();

        // The rules in use, the page builds its limits and rule chips from this
        schema.MapGet("/", (RulesService rules) => Results.Ok(rules.Current));

        // Every rules version, newest first
        schema.MapGet("/versions", async (AppDbContext db) =>
        {
            var rows = await db.RuleVersions.OrderByDescending(r => r.Id).ToListAsync();
            return Results.Ok(rows.Select(RulesService.ToRuleSet));
        });

        // Saves new rules as the next version, a full copy of the table goes to the collector first
        schema.MapPut("/", async (SaveRules body, AppDbContext db, RulesService rules, ICurrentUser user,
            ILogger<RulesService> log, CancellationToken ct) =>
        {
            var errors = rules.CheckNewRules(body);
            if (errors.Count > 0)
            {
                return Results.ValidationProblem(errors);
            }

            try
            {
                return Results.Ok(await rules.SaveAsync(db, body, user.Name, ct));
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogError(ex, "Saving new rules failed");
                return Results.Problem("Couldn't save a copy of the table first, so the rules didn't change. Try again in a moment",
                    statusCode: StatusCodes.Status503ServiceUnavailable, title: "Backup not available");
            }
        }).RequireAdmin();

        var history = app.MapGroup("/history").RequireDatabaseReady().RequireAdmin();

        // Saved versions in the collector, the History page (step 5) builds on this
        history.MapGet("/versions", async (CollectorStore collector, CancellationToken ct) =>
            Results.Ok(await collector.ListVersionsAsync(ct)));
    }

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
