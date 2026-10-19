using System.Text.Json;
using api_v2.Application.Health;
using api_v2.Application.Ports;

namespace api_v2.Presentation.Endpoints;

public static class HealthEndpoints
{
    // Always 200 so the frontend can read the state, the body says if the database is usable.
    // databases names the live table and the history database. The old fields stay as they are.
    // Someone not signed in only learns if the database is up, which is all the page's badge needs. Signed in, it also
    // names the databases and the migrations applied, which the seeding script prints.
    public static void MapHealth(this WebApplication app)
    {
        app.MapGet("/health", async (DatabaseStatus status, IDatabaseNames databases, ICurrentUser user, CancellationToken ct) =>
        {
            var body = JsonSerializer.SerializeToNode(status.Snapshot())!.AsObject();
            var signedIn = false;
            if (status.State == DatabaseState.Ready)
            {
                try
                {
                    await user.LoadAsync(ct);
                    signedIn = user.IsSignedIn;
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    // The answer still goes out, just the short one
                }
            }
            if (!signedIn)
            {
                var history = body["history"]?.AsObject();
                return Results.Json(new
                {
                    state = body["state"]?.GetValue<string>(),
                    // The ready message lists every migration, the others say what's wrong in plain words
                    message = status.State == DatabaseState.Ready ? "Ready" : body["message"]?.GetValue<string>(),
                    history = new { ready = history?["ready"]?.GetValue<bool>() ?? false, message = history?["message"]?.GetValue<string>() ?? "" }
                });
            }
            // Web options, so the names come out as live, history, host, port and database, as they always did
            body["databases"] = JsonSerializer.SerializeToNode(databases.Describe(), JsonSerializerOptions.Web);
            return Results.Json(body);
        });
    }
}
