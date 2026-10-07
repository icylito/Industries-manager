using api_v2.Auth;
using api_v2.Backups;
using api_v2.Data;
using Microsoft.EntityFrameworkCore;

namespace api_v2.Endpoints;

public record RestoreBackupBody(string? Confirm);

public static class BackupEndpoints
{
    public static void MapBackups(this WebApplication app)
    {
        var group = app.MapGroup("/backups").RequireDatabaseReady().RequireAdmin();

        group.MapGet("/", (BackupService backups, BackupRestore restore) => Results.Ok(new
        {
            backups = backups.List().Select(b => Describe(b, restore)),
            status = backups.Status()
        }));

        group.MapPost("/", async (BackupService backups, BackupRestore restore, ICurrentUser user, ILogger<BackupService> log, CancellationToken ct) =>
        {
            try
            {
                return Results.Ok(Describe(await backups.RunAsync("manual", user.Name, ct), restore));
            }
            catch (BackupBusyException)
            {
                return Results.Conflict("A backup is already running, try again in a minute");
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // Only this code's own words reach the page, the tool's and the framework's stay in the log
                log.LogError(ex, "Backup failed");
                return Results.Problem(
                    $"The backup didn't finish. {BackupService.PlainMessage(ex)}",
                    statusCode: StatusCodes.Status503ServiceUnavailable,
                    title: "Backup didn't finish");
            }
        });

        // What a restore from this backup would do. Nothing is changed.
        group.MapGet("/{id}/restore/preview", async (string id, BackupService backups, BackupRestore restore,
            DatabaseStatus status, AppDbContext db, CancellationToken ct) =>
        {
            var entry = backups.Find(id);
            if (entry is null) return Results.NotFound($"There's no backup {id}");
            return Results.Ok(new
            {
                entry.Id,
                entry.CreatedAt,
                entry.RulesVersion,
                entry.RowCount,
                SameLayout = restore.SameLayout(entry),
                CurrentRows = await db.Industries.CountAsync(ct),
                HistoryReady = status.HistoryReady
            });
        });

        // Puts the table, its rules, settings and requests back the way they were in this backup.
        // Accounts and sign ins stay as they are now. The table as it is now is saved to History first.
        group.MapPost("/{id}/restore", async (string id, RestoreBackupBody body, BackupRestore restore, DatabaseStatus status,
            ICurrentUser user, ILogger<BackupRestore> log, CancellationToken ct) =>
        {
            if (body.Confirm != "RESTORE")
            {
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["confirm"] = ["Type RESTORE to confirm"] });
            }
            if (!status.HistoryReady)
            {
                return Results.Problem(
                    "History isn't available right now, so a copy of the table can't be saved first. Nothing was changed. Try again in a moment",
                    statusCode: StatusCodes.Status503ServiceUnavailable, title: "History not available");
            }
            try
            {
                return Results.Ok(await restore.RunAsync(id, user.Name, ct));
            }
            catch (BackupRefusedException ex)
            {
                return Results.Conflict(ex.Message);
            }
            catch (AppBusyException)
            {
                throw;
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogError(ex, "Restoring backup {Backup} failed", id);
                return Results.Problem(BackupService.PlainMessage(ex),
                    statusCode: StatusCodes.Status503ServiceUnavailable, title: "Restore didn't finish");
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

    // What the page sees about one backup. SameLayout says if Restore is possible from the page.
    private static object Describe(BackupEntry b, BackupRestore restore) => new
    {
        b.Id, b.CreatedAt, b.Kind, b.By, b.MainSize, b.CollectorSize, b.RulesVersion, b.HasExcel, b.RowCount,
        SameLayout = restore.SameLayout(b)
    };
}
