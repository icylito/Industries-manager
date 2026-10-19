using api_v2.Application.Auth;
using api_v2.Application.Ports;
using api_v2.Application.Rules;
using api_v2.Domain.Rules;
using api_v2.Presentation.Authorization;

namespace api_v2.Presentation.Endpoints;

// The rules routes. Reads come from the rules in use; every change is one call into Application/Rules/RuleChanges,
// which owns the lock order, the version check and the copy saved before a rules version.
public static class SchemaEndpoints
{
    public static void MapSchema(this WebApplication app)
    {
        var schema = app.MapGroup("/schema").RequireDatabaseReady();

        // The rules in use, the page builds its limits and rule chips from this
        schema.MapGet("/", (RulesService rules) => Results.Ok(rules.Current)).RequireViewer();

        // Every rules version, newest first
        schema.MapGet("/versions", async (RulesAdminService admin) =>
            Results.Ok(await admin.VersionsAsync(CancellationToken.None))).RequireSignIn();

        // Saves new rules as the next version, a full copy of the table goes to the collector first
        schema.MapPut("/", async (SaveRules body, RuleChanges changes, ICurrentUser user, CancellationToken ct) =>
            Answer(await changes.SaveAsync(body, user.Name, ct), "the rules didn't change")).RequireAdmin();

        // Adds a custom field, its values live in each row's Extra JSON so no C# or migration is needed
        schema.MapPost("/fields", async (NewField body, RuleChanges changes, ICurrentUser user, CancellationToken ct) =>
            Answer(await changes.AddFieldAsync(body, user.Name, ct), "the field wasn't added")).RequireAdmin();

        // Several custom fields in one rules version and one table copy
        schema.MapPost("/fields/many", async (NewFields body, RuleChanges changes, ICurrentUser user, CancellationToken ct) =>
            Answer(await changes.AddFieldsAsync(body, user.Name, ct), "the field wasn't added")).RequireAdmin();

        // Removes a field the page added. Built in fields stay. A copy of the table is saved first.
        schema.MapDelete("/fields/{key}", async (string key, int? basedOn, RuleChanges changes, ICurrentUser user, CancellationToken ct) =>
            Answer(await changes.DeleteFieldAsync(key, basedOn, user.Name, ct), "the field wasn't deleted")).RequireAdmin();
    }

    // What the page reads for each outcome. whatDidntHappen finishes the sentence when the table copy failed.
    private static IResult Answer<T>(RuleChangeResult<T> result, string whatDidntHappen) => result switch
    {
        RuleChangeResult<T>.Done done => Results.Ok(done.Value),
        RuleChangeResult<T>.NoBasedOn => NoBasedOn(),
        RuleChangeResult<T>.Stale => Results.Conflict(
            "Someone changed the fields since you opened this page. Reload to see their changes, then save again"),
        RuleChangeResult<T>.Invalid invalid => Results.ValidationProblem(invalid.Errors),
        RuleChangeResult<T>.Refused refused => Results.BadRequest(refused.Message),
        RuleChangeResult<T>.NotFound notFound => Results.NotFound(notFound.Message),
        _ => Results.Problem($"Couldn't save a copy of the table first, so {whatDidntHappen}. Try again in a moment",
            statusCode: StatusCodes.Status503ServiceUnavailable, title: "Backup not available")
    };

    // Without the version the page was looking at, two admins saving at once would quietly undo each other
    private static IResult NoBasedOn() => Results.ValidationProblem(new Dictionary<string, string[]>
    {
        ["basedOn"] = ["Reload the Fields page and try again"]
    });

    // While migrations run or after they fail, answer 503 instead of hitting a half ready database
    public static RouteGroupBuilder RequireDatabaseReady(this RouteGroupBuilder group) =>
        group.AddEndpointFilter(async (context, next) =>
        {
            var status = context.HttpContext.RequestServices.GetRequiredService<api_v2.Application.Health.DatabaseStatus>();
            if (status.State != api_v2.Application.Health.DatabaseState.Ready)
            {
                return Results.Problem(status.Message, statusCode: StatusCodes.Status503ServiceUnavailable,
                    title: "Database not ready");
            }
            return await next(context);
        });
}
