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
using api_v2.Domain.Entities;
using api_v2.Application.Requests;
using api_v2.Domain.Rules;
using Microsoft.EntityFrameworkCore;

namespace api_v2.Presentation.Endpoints;

public record AskBody(string? Title, string? Details, string? Code = null);
public record ColumnAsk(string? Label, string? Type, string? FieldKey, string? Details);
public record TypeAsk(string? FieldKey, string? Type);
public record StatusBody(string? Status);
public record MessageBody(string? Body);

public static class RequestEndpoints
{
    public static void MapRequests(this WebApplication app)
    {
        var requests = app.MapGroup("/requests").RequireDatabaseReady().RequireSignIn();

        // status is open (default), in-progress, done, dismissed, active (open or in-progress) or all
        requests.MapGet("/", async (string? status, AppDbContext db, CancellationToken ct) =>
        {
            var query = db.Requests.AsNoTracking();
            status ??= "open";
            if (status == "active") query = query.Where(r => r.Status == "open" || r.Status == "in-progress");
            else if (status != "all") query = query.Where(r => r.Status == status);
            return Results.Ok(await query.OrderByDescending(r => r.Id).Select(r => new
            {
                r.Id, r.CreatedAt, r.Kind, r.Title, r.Details, r.DraftedCode, r.Status, r.CreatedBy, r.FieldKey,
                r.ResolvedAt, r.ResolvedBy,
                Replies = db.RequestMessages.Count(m => m.RequestId == r.Id)
            }).ToListAsync(ct));
        });

        // One request with its conversation, oldest message first
        requests.MapGet("/{id:int}", async (int id, AppDbContext db, CancellationToken ct) =>
        {
            var request = await db.Requests.AsNoTracking().FirstOrDefaultAsync(r => r.Id == id, ct);
            if (request is null) return Results.NotFound("There's no request with that id");
            var messages = await db.RequestMessages.AsNoTracking().Where(m => m.RequestId == id).OrderBy(m => m.Id).ToListAsync(ct);
            return Results.Ok(new { request, messages });
        });

        // The person who asked and the admins talk here. Anyone else can read it but not write.
        requests.MapPost("/{id:int}/messages", async (int id, MessageBody body, AppDbContext db, ICurrentUser user, AppLocks locks, CancellationToken ct) =>
        {
            var text = body.Body?.Trim() ?? "";
            if (text.Length == 0 || text.Length > 2000)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["body"] = ["Write a message of 1 to 2000 characters"] });
            }
            await using var requestsLock = await locks.TakeAsync(AppLock.Requests, ct);
            var request = await db.Requests.FindAsync([id], ct);
            if (request is null) return Results.NotFound("There's no request with that id");
            var isAsker = string.Equals(request.CreatedBy, user.Name, StringComparison.Ordinal);
            if (!user.IsAdmin && !isAsker)
            {
                return Results.Json(new { message = "Only the person who asked and the admins can reply here" }, statusCode: StatusCodes.Status403Forbidden);
            }
            var message = new RequestMessage
            {
                RequestId = id,
                CreatedAt = DateTimeOffset.UtcNow,
                Author = user.Name,
                FromDeveloper = user.IsAdmin,
                Body = text
            };
            db.RequestMessages.Add(message);
            // A developer answering means someone picked it up
            if (user.IsAdmin && request.Status == "open") request.Status = "in-progress";
            await db.SaveChangesAsync(ct);
            return Results.Ok(new { message, status = request.Status });
        });

        // The number on the bell
        requests.MapGet("/count", async (AppDbContext db, CancellationToken ct) =>
            Results.Ok(new { Open = await db.Requests.CountAsync(r => r.Status == "open" || r.Status == "in-progress", ct) }));

        // Anything else the team needs a developer for
        requests.MapPost("/", async (AskBody body, AppDbContext db, ICurrentUser user, AppLocks locks, CancellationToken ct) =>
        {
            var errors = new Dictionary<string, string[]>();
            if (string.IsNullOrWhiteSpace(body.Title) || body.Title.Trim().Length > 120) errors["title"] = ["Say what you need in 1 to 120 characters"];
            if (body.Details?.Length > 2000) errors["details"] = ["Keep the details under 2000 characters"];
            if (body.Code?.Length > RequestService.MaxCodeLength) errors["code"] = [$"Keep the code under {RequestService.MaxCodeLength} characters"];
            if (errors.Count > 0) return Results.ValidationProblem(errors);
            var code = string.IsNullOrWhiteSpace(body.Code) ? null : body.Code.Trim('\r', '\n').TrimEnd();
            var request = await RequestService.CreateAsync(db, locks, "other", body.Title!.Trim(), body.Details?.Trim() ?? "", code, user.Name, ct: ct);
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
        }).RequireAdmin();

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
            return request.Created
                ? Results.Created($"/requests/{request.Request.Id}", request.Request)
                : Results.Ok(request.Request);
        }).RequireAdmin();

        // Developers mark requests done or dismissed, open brings one back
        requests.MapPut("/{id:int}/status", async (int id, StatusBody body, AppDbContext db, ICurrentUser user, AppLocks locks, CancellationToken ct) =>
        {
            await using var requestsLock = await locks.TakeAsync(AppLock.Requests, ct);
            if (body.Status is not ("open" or "in-progress" or "done" or "dismissed"))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["status"] = ["Status has to be open, in-progress, done or dismissed"] });
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
            var finished = body.Status is "done" or "dismissed";
            request.ResolvedAt = finished ? DateTimeOffset.UtcNow : null;
            request.ResolvedBy = finished ? user.Name : null;
            await db.SaveChangesAsync(ct);
            return Results.Ok(request);
        }).RequireAdmin();
    }
}
