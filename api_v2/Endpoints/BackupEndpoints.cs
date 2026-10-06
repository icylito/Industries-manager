using api_v2.Auth;
using api_v2.Backups;

namespace api_v2.Endpoints;

public static class BackupEndpoints
{
    public static void MapBackups(this WebApplication app)
    {
        var group = app.MapGroup("/backups").RequireDatabaseReady().RequireAdmin();

        group.MapGet("/", (BackupService backups) => Results.Ok(new { backups = backups.List(), status = backups.Status() }));

        group.MapPost("/", async (BackupService backups, ICurrentUser user, ILogger<BackupService> log, CancellationToken ct) =>
        {
            try
            {
                return Results.Ok(await backups.RunAsync("manual", user.Name, ct));
            }
            catch (BackupBusyException)
            {
                return Results.Conflict("A backup is already running, try again in a minute");
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogError(ex, "Backup failed");
                var reason = ex.Message.Trim();
                var join = reason.EndsWith('.') || reason.EndsWith('?') || reason.EndsWith('!') ? " " : ". ";
                return Results.Problem(
                    $"The backup didn't finish: {reason}{join}Nothing was changed",
                    statusCode: StatusCodes.Status503ServiceUnavailable,
                    title: "Backup didn't finish");
            }
        });

        group.MapGet("/{id}/{file}", (string id, string file, BackupService backups) =>
        {
            if (!BackupService.ValidId(id) || file is not ("main" or "collector" or "excel"))
            {
                return Results.BadRequest("That isn't a backup file");
            }

            var path = backups.ResolveDump(id, file);
            if (path is null)
            {
                return Results.BadRequest("That isn't a backup file");
            }
            if (!File.Exists(path))
            {
                return Results.NotFound($"There's no backup {id}");
            }
            // excel is a CSV with a BOM, Excel opens it with a double click
            return file == "excel"
                ? Results.File(path, "text/csv", $"industries-{id}.csv")
                : Results.File(path, "application/octet-stream", $"{id}-{file}.dump");
        });
    }
}
