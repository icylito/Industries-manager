using api_v2.Application.Auth;
using api_v2.Application.Requests;
using api_v2.Presentation.Contracts;

using api_v2.Presentation.Authorization;
using api_v2.Application.Ports;

namespace api_v2.Presentation.Endpoints;

// The requests routes. Each endpoint binds its input, calls one use case in Application/Requests and turns the
// answer into an HTTP result.
public static class RequestEndpoints
{
    public static void MapRequests(this WebApplication app)
    {
        var requests = app.MapGroup("/requests").RequireDatabaseReady().RequireSignIn();

        // status is open (default), in-progress, done, dismissed, active (open or in-progress) or all
        requests.MapGet("/", async (string? status, RequestService service, CancellationToken ct) =>
            Results.Ok(await service.ListAsync(status, ct)));

        // One request with its conversation, oldest message first
        requests.MapGet("/{id:int}", async (int id, RequestService service, CancellationToken ct) =>
        {
            var result = await service.GetAsync(id, ct);
            return result switch
            {
                GetRequestResult.Found found => Results.Ok(new { request = DevRequestView.From(found.Request), messages = found.Messages.Select(RequestMessageView.From) }),
                _ => Results.NotFound("There's no request with that id")
            };
        });

        // The person who asked and the admins talk here. Anyone else can read it but not write.
        requests.MapPost("/{id:int}/messages", async (int id, MessageBody body, RequestService service, ICurrentUser user, CancellationToken ct) =>
        {
            var result = await service.AddMessageAsync(id, body.Body, user, ct);
            return result switch
            {
                AddMessageResult.Added added => Results.Ok(new { Message = RequestMessageView.From(added.Message), added.Status }),
                AddMessageResult.Forbidden => Results.Json(new { message = "Only the person who asked and the admins can reply here" },
                    statusCode: StatusCodes.Status403Forbidden),
                AddMessageResult.Invalid invalid => Results.ValidationProblem(invalid.Errors),
                _ => Results.NotFound("There's no request with that id")
            };
        });

        // The number on the bell
        requests.MapGet("/count", async (RequestService service, CancellationToken ct) =>
            Results.Ok(new { Open = await service.CountActiveAsync(ct) }));

        // Anything else the team needs a developer for
        requests.MapPost("/", async (AskBody body, RequestService service, ICurrentUser user, CancellationToken ct) =>
            AskResult(await service.AskAsync(body.Title, body.Details, body.Code, user, ct)));

        // A real column, or turning a custom field into one. Comes with the C# drafted.
        requests.MapPost("/column", async (ColumnAsk body, RequestService service, ICurrentUser user, CancellationToken ct) =>
            AskResult(await service.ColumnAsync(body.Label, body.Type, body.FieldKey, body.Details, user, ct))).RequireAdmin();

        // Changing a custom field's type needs its values converted, so a developer does it
        requests.MapPost("/field-type", async (TypeAsk body, RequestService service, ICurrentUser user, CancellationToken ct) =>
            AskResult(await service.FieldTypeAsync(body.FieldKey, body.Type, user, ct))).RequireAdmin();

        // Developers mark requests done or dismissed, open brings one back
        requests.MapPut("/{id:int}/status", async (int id, StatusBody body, RequestService service, ICurrentUser user, CancellationToken ct) =>
        {
            var result = await service.SetStatusAsync(id, body.Status, user, ct);
            return result switch
            {
                SetStatusResult.Updated updated => Results.Ok(DevRequestView.From(updated.Request)),
                SetStatusResult.Invalid invalid => Results.ValidationProblem(invalid.Errors),
                SetStatusResult.Conflict conflict => Results.Conflict($"The same request is already open (#{conflict.OtherId})"),
                _ => Results.NotFound("There's no request with that id")
            };
        }).RequireAdmin();
    }

    private static IResult AskResult(AskRequestResult result) => result switch
    {
        AskRequestResult.Created created => Results.Created($"/requests/{created.Request.Id}", DevRequestView.From(created.Request)),
        AskRequestResult.Existing existing => Results.Ok(DevRequestView.From(existing.Request)),
        AskRequestResult.Invalid invalid => Results.ValidationProblem(invalid.Errors),
        _ => Results.Problem()
    };
}
