using api_v2.Auth;
using api_v2.Data;
using api_v2.Requests;
using api_v2.Rules;
using Microsoft.EntityFrameworkCore;

namespace api_v2.Endpoints;

public record AskBody(string? Title, string? Details);
public record ColumnAsk(string? Label, string? Type, string? FieldKey, string? Details);
public record TypeAsk(string? FieldKey, string? Type);
public record StatusBody(string? Status);

public static class RequestEndpoints
{
    public static void MapRequests(this WebApplication app)
    {
        var requests = app.MapGroup("/requests").RequireDatabaseReady();

        // status is open (default), done, dismissed or all
        requests.MapGet("/", async (string? status, AppDbContext db, CancellationToken ct) =>
        {
            var query = db.Requests.AsNoTracking();
            status ??= "open";
            if (status != "all") query = query.Where(r => r.Status == status);
            return Results.Ok(await query.OrderByDescending(r => r.Id).ToListAsync(ct));
        });

        // The number on the bell
        requests.MapGet("/count", async (AppDbContext db, CancellationToken ct) =>
            Results.Ok(new { Open = await db.Requests.CountAsync(r => r.Status == "open", ct) }));

        // Anything else the team needs a developer for
        requests.MapPost("/", async (AskBody body, AppDbContext db, ICurrentUser user, AppLocks locks, CancellationToken ct) =>
        {
            var errors = new Dictionary<string, string[]>();
            if (string.IsNullOrWhiteSpace(body.Title) || body.Title.Trim().Length > 120) errors["title"] = ["Say what you need in 1 to 120 characters"];
            if (body.Details?.Length > 2000) errors["details"] = ["Keep the details under 2000 characters"];
            if (errors.Count > 0) return Results.ValidationProblem(errors);
            var request = await RequestService.CreateAsync(db, locks, "other", body.Title!.Trim(), body.Details?.Trim() ?? "", null, user.Name, ct: ct);
            return request.Created
                ? Results.Created($"/requests/{request.Request.Id}", request.Request)
                : Results.Ok(request.Request);
        });

        // A real column, or turning a custom field into one. Comes with the C# drafted.
        requests.MapPost("/column", async (ColumnAsk body, AppDbContext db, RulesService rules, ICurrentUser user, AppLocks locks, CancellationToken ct) =>
        {
            var field = body.FieldKey is null ? null : rules.Current.Fields.FirstOrDefault(f => f.Key == body.FieldKey && f.Custom);
            var label = field?.Label ?? body.Label?.Trim();
            var type = field?.Type ?? body.Type;
            if (field is null && label is not null && Names.HasHiddenCharacters(label))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["label"] = ["The label can't contain line breaks or hidden characters"]
                });
            }
            if (string.IsNullOrWhiteSpace(label) || label.Length > 40 || type is not ("text" or "number" or "date"))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["column"] = ["Give the column a name (up to 40 characters) and a type: text, number or date"] });
            }
            var title = field is null ? $"Add a real column \"{label}\"" : $"Turn \"{label}\" into a real column";
            var details = (body.Details?.Trim() is { Length: > 0 } d ? d + "\n\n" : "") +
                $"A {type} column called \"{label}\" in the Industries table." +
                (field is null ? "" : $" Its values are in the custom field \"{field.Key}\" today, move them over once the column exists.");
            var request = await RequestService.CreateAsync(db, locks, "column", title, details, Drafts.NewColumn(label, type), user.Name, field?.Key, ct);
            return request.Created
                ? Results.Created($"/requests/{request.Request.Id}", request.Request)
                : Results.Ok(request.Request);
        });

        // Changing a custom field's type needs its values converted, so a developer does it
        requests.MapPost("/field-type", async (TypeAsk body, AppDbContext db, RulesService rules, ICurrentUser user, AppLocks locks, CancellationToken ct) =>
        {
            var field = rules.Current.Fields.FirstOrDefault(f => f.Key == body.FieldKey && f.Custom);
            if (field is null || body.Type is not ("text" or "number" or "date") || body.Type == field.Type)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["type"] = ["Pick a custom field and a different type: text, number or date"] });
            }
            var request = await RequestService.CreateAsync(db, locks, "field-type", $"Change \"{field.Label}\" from {field.Type} to {body.Type}",
                $"The team wants \"{field.Label}\" to be a {body.Type} instead of {field.Type}. Values that don't fit the new type will show as --.",
                Drafts.FieldType(field.Key, field.Label, field.Type, body.Type), user.Name, field.Key, ct);
            return Results.Created($"/requests/{request.Request.Id}", request.Request);
        });

        // Developers mark requests done or dismissed, open brings one back
        requests.MapPut("/{id:int}/status", async (int id, StatusBody body, AppDbContext db, ICurrentUser user, AppLocks locks, CancellationToken ct) =>
        {
            await using var requestsLock = await locks.TakeAsync(AppLock.Requests, ct);
            if (body.Status is not ("open" or "done" or "dismissed"))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["status"] = ["Status has to be open, done or dismissed"] });
            }
            var request = await db.Requests.FindAsync([id], ct);
            if (request is null) return Results.NotFound("There's no request with that id");
            if (body.Status == "open")
            {
                var title = request.Title.ToLower();
                var other = await db.Requests.FirstOrDefaultAsync(
                    r => r.Id != id && r.Status == "open" && r.Kind == request.Kind && r.FieldKey == request.FieldKey
                         && r.Title.ToLower() == title, ct);
                if (other is not null)
                {
                    return Results.Conflict($"The same request is already open (#{other.Id})");
                }
            }
            request.Status = body.Status;
            request.ResolvedAt = body.Status == "open" ? null : DateTimeOffset.UtcNow;
            request.ResolvedBy = body.Status == "open" ? null : user.Name;
            await db.SaveChangesAsync(ct);
            return Results.Ok(request);
        }).RequireAdmin();
    }
}
