using api_v2.Application.Health;
using api_v2.Application.History;
using api_v2.Application.Ports;
using api_v2.Domain.Collector;
using api_v2.Presentation.Contracts;

using api_v2.Presentation.Authorization;

namespace api_v2.Presentation.Endpoints;

// The History page. Each route binds its input, calls one use case in Application/History and turns the answer into
// an HTTP result; the locks, the copy saved before a change and every collector call live behind that service, and
// the restore's single transaction lives behind IHistoryRestoreRunner.
public static class HistoryEndpoints
{
    // The longest a restore note can be, counted in the same UTF-16 characters the page counts. The page checks the
    // same limit in Components/history/history.ts (noteMax), change both together.
    public const int NoteMax = HistoryService.NoteMax;

    // The message the page shows before importing data saved under other rules
    public const string RulesDifferMessage = HistoryService.RulesDifferMessage;

    public static void MapHistory(this WebApplication app)
    {
        var history = app.MapGroup("/history").RequireDatabaseReady().RequireAdmin();
        history.AddEndpointFilter(async (context, next) =>
        {
            var status = context.HttpContext.RequestServices.GetRequiredService<DatabaseStatus>();
            if (!status.HistoryReady)
            {
                return Results.Problem(
                    "History isn't available right now, nothing was changed. Try again in a moment",
                    statusCode: StatusCodes.Status503ServiceUnavailable, title: "History not available");
            }
            try
            {
                return await next(context);
            }
            catch (Exception ex) when (HistoryDown(context.HttpContext, ex))
            {
                var log = context.HttpContext.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger(nameof(HistoryEndpoints));
                log.LogError(ex, "History database failed");
                context.HttpContext.RequestServices.GetRequiredService<ICollectorStore>().NoteFailure(ex);
                return Results.Problem(
                    "History isn't available right now, nothing was changed. Try again in a moment",
                    statusCode: StatusCodes.Status503ServiceUnavailable, title: "History not available");
            }
        });

        // Saved versions, newest first. SameLayout says if the table looked the same back then.
        history.MapGet("/versions", async (HistoryService service, CancellationToken ct) =>
            Results.Ok(await service.VersionsAsync(ct)));

        // One version with its rows, for View
        history.MapGet("/versions/{id:long}", async (long id, HistoryService service, CancellationToken ct) =>
            (await service.VersionAsync(id, ct)) is { } view ? Results.Ok(view) : NotFound(id));

        // A version as a CSV file, opens in Excel
        history.MapGet("/versions/{id:long}/download", async (long id, HistoryService service, CancellationToken ct) =>
            (await service.DownloadAsync(id, ct)) is { } file
                ? Results.File(file.Bytes, "text/csv", file.FileName)
                : NotFound(id));

        // Pinned versions never get removed by retention
        history.MapPut("/versions/{id:long}/pin", async (long id, PinBody body, HistoryService service, CancellationToken ct) =>
            (await service.PinAsync(id, body.Pinned, ct)) ? Results.NoContent() : NotFound(id));

        // Delete one saved version for good. Waits for a restore or import that is reading it, and a pinned one stays.
        history.MapDelete("/versions/{id:long}", async (long id, HistoryService service, ICurrentUser user, CancellationToken ct) =>
        {
            var result = await service.DeleteAsync(id, user.Name, ct);
            return result switch
            {
                DeleteVersionResult.Deleted deleted => Results.Ok(new { Deleted = deleted.Id }),
                DeleteVersionResult.Pinned => Results.Conflict($"Version #{id} is pinned. Unpin it first if you want to delete it"),
                _ => NotFound(id)
            };
        });

        // Puts the table back the way it was in this version, rows and rules. The current state gets saved first.
        history.MapPost("/versions/{id:long}/restore", async (long id, RestoreBody body, HistoryService service,
            ICurrentUser user, CancellationToken ct) =>
        {
            var result = await service.RestoreAsync(id, body.Note, user.Name, ct);
            return result switch
            {
                RestoreResult.Done restored => Results.Ok(new
                {
                    restored.Restored,
                    restored.Skipped,
                    restored.LostValues,
                    restored.RulesRestored,
                    restored.RequestId
                }),
                RestoreResult.Invalid invalid => Results.ValidationProblem(invalid.Errors),
                RestoreResult.Damaged => Results.Conflict(DamagedMessage),
                RestoreResult.NameClash => Results.Conflict(SameNameMessage),
                RestoreResult.BackupFailed failed => BackupFailed(failed.What),
                _ => NotFound(id)
            };
        });

        // What an import from this version would add, nothing gets written
        history.MapPost("/versions/{id:long}/import/preview", async (long id, HistoryService service, CancellationToken ct) =>
        {
            var result = await service.PreviewImportAsync(id, ct);
            return result switch
            {
                ImportPreviewResult.Preview preview => Results.Ok(preview.View),
                ImportPreviewResult.Damaged => Results.Conflict(DamagedMessage),
                _ => NotFound(id)
            };
        });

        // Adds the version's rows as new rows with new ids. Nothing gets replaced.
        history.MapPost("/versions/{id:long}/import", async (long id, ImportBody body, HistoryService service,
            ICurrentUser user, CancellationToken ct) =>
        {
            var result = await service.ImportAsync(id, body.Confirm, body.SkipDuplicates, user.Name, ct);
            return result switch
            {
                ImportResult.Imported imported => Results.Ok(new
                {
                    Imported = imported.Count,
                    imported.Similar,
                    imported.LostValues,
                    imported.BreakingRules,
                    imported.Skipped,
                    imported.LeftOutDuplicates,
                    imported.RequestIds
                }),
                ImportResult.NeedsConfirm => Results.Conflict(new { NeedsConfirm = true, Message = RulesDifferMessage }),
                ImportResult.NeedsDecision decision => Results.Conflict(new
                {
                    NeedsDecision = "duplicates",
                    decision.Similar,
                    decision.Total,
                    decision.AlreadyImportedFromThisVersion,
                    decision.Message
                }),
                ImportResult.NothingNew => Results.Conflict(
                    "Every row in that version is already in the table, so there's nothing new to bring back"),
                ImportResult.Damaged => Results.Conflict(DamagedMessage),
                ImportResult.BackupFailed failed => BackupFailed(failed.What),
                _ => NotFound(id)
            };
        });

        history.MapSettingsFile();

        history.MapGet("/settings", (HistoryService service) => Results.Ok(service.Retention));

        // How many saved versions these settings would remove, nothing is saved or deleted
        history.MapPost("/settings/preview", async (Retention body, HistoryService service, CancellationToken ct) =>
        {
            var result = await service.PreviewRetentionAsync(body, ct);
            return result switch
            {
                RetentionPreviewResult.Preview preview => Results.Ok(new { preview.WillRemove }),
                RetentionPreviewResult.Invalid invalid => Results.ValidationProblem(invalid.Errors),
                _ => Results.Problem()
            };
        });

        history.MapPut("/settings", async (Retention body, HistoryService service, ICurrentUser user, CancellationToken ct) =>
        {
            var result = await service.SaveRetentionAsync(body, user.Name, ct);
            return result switch
            {
                RetentionSaveResult.Saved saved => Results.Ok(new
                {
                    saved.KeepVersions,
                    saved.KeepDays,
                    saved.Removed,
                    saved.Note
                }),
                RetentionSaveResult.Invalid invalid => Results.ValidationProblem(invalid.Errors),
                _ => Results.Problem()
            };
        });
    }

    private const string DamagedMessage = "That saved version is damaged, so it can't be used. Nothing was changed";

    private const string SameNameMessage =
        "Two rows in that version have the same name, so it can't be restored as it was. Nothing was changed. Try Import instead";

    // The collector being down, or its tables not existing yet, is one answer for every history route
    private static bool HistoryDown(HttpContext http, Exception ex) =>
        http.RequestServices.GetRequiredService<ICollectorStore>().IsDown(ex);

    private static IResult NotFound(long id) => Results.NotFound($"There's no saved version #{id}");

    private static IResult BackupFailed(string what) => Results.Problem(
        $"Couldn't save a copy of the table first, so {what}. Try again in a moment",
        statusCode: StatusCodes.Status503ServiceUnavailable, title: "Backup not available");
}
