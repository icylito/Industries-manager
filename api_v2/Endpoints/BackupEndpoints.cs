using api_v2.Auth;
using api_v2.Backups;
using api_v2.Data;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Net.Http.Headers;

namespace api_v2.Endpoints;

public record RestoreBackupBody(string? Confirm);

public static class BackupEndpoints
{
    public static void MapBackups(this WebApplication app)
    {
        // Managers and admins (decided 2026-10-09): a manager can take, download, upload and restore backups,
        // because restoring is how a team gets its tables back. Rules, History and Settings stay admin only.
        var group = app.MapGroup("/backups").RequireDatabaseReady().RequireManager();

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

        // Puts the table, its rules, settings, requests and every table from the Tables page back the way they were
        // in this backup. Accounts and sign ins stay as they are now. A full backup of right now is taken first
        // (UndoBackup in the answer), and the industries as they are now are saved to History too.
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

        // The whole backup as one signed zip, to keep somewhere else and drop back in later
        group.MapGet("/{id}/download", (string id, BackupService backups) =>
        {
            if (!BackupService.ValidId(id)) return Results.BadRequest("That isn't a backup");
            var zip = backups.ZipOf(id);
            if (zip is null) return Results.NotFound($"There's no backup {id}");
            // Deleted as soon as it has been sent
            var stream = new FileStream(zip, FileMode.Open, FileAccess.Read, FileShare.Delete, 81920, FileOptions.DeleteOnClose);
            return Results.File(stream, "application/zip", $"backup-{id}.zip");
        });

        // A backup zip dropped in from the page. It is checked and added to the list; restoring it is a separate step.
        // Read as it arrives, with the size cap counted on the way in, so a huge file never fills the disk.
        group.MapPost("/upload", async (HttpRequest request, BackupService backups, BackupRestore restore, IConfiguration config,
            ICurrentUser user, ILogger<BackupService> log, CancellationToken ct) =>
        {
            var maxBytes = Math.Max(1, config.GetValue("Backup:MaxUploadMb", 2048)) * 1024L * 1024L;
            if (!MediaTypeHeaderValue.TryParse(request.ContentType, out var media)
                || !media.MediaType.Equals("multipart/form-data", StringComparison.OrdinalIgnoreCase)
                || HeaderUtilities.RemoveQuotes(media.Boundary).Value is not { Length: > 0 } boundary)
            {
                return Results.Problem("Send the backup as a file", statusCode: StatusCodes.Status400BadRequest, title: "Couldn't read it");
            }

            var bodyLimit = request.HttpContext.Features.Get<IHttpMaxRequestBodySizeFeature>();
            if (bodyLimit is { IsReadOnly: false }) bodyLimit.MaxRequestBodySize = maxBytes + 1024 * 1024;

            var temp = backups.NewUploadPath();
            try
            {
                var reader = new MultipartReader(boundary, request.Body);
                MultipartSection? section;
                var got = false;
                while ((section = await reader.ReadNextSectionAsync(ct)) is not null)
                {
                    if (!ContentDispositionHeaderValue.TryParse(section.ContentDisposition, out var disposition)
                        || !disposition.IsFileDisposition()) continue;

                    await using (var target = new FileStream(temp, FileMode.CreateNew, FileAccess.Write))
                    {
                        var buffer = new byte[81920];
                        long total = 0;
                        int read;
                        while ((read = await section.Body.ReadAsync(buffer, ct)) > 0)
                        {
                            total += read;
                            if (total > maxBytes)
                            {
                                return Results.Problem($"That file is bigger than {maxBytes / (1024 * 1024)} MB, so it can't be used. Nothing was changed",
                                    statusCode: StatusCodes.Status413PayloadTooLarge, title: "Too big");
                            }
                            await target.WriteAsync(buffer.AsMemory(0, read), ct);
                        }
                    }
                    got = true;
                    break;
                }
                if (!got)
                {
                    return Results.Problem("No file was sent", statusCode: StatusCodes.Status400BadRequest, title: "Couldn't read it");
                }

                var entry = await backups.ImportAsync(temp, user.Name, maxBytes, ct);
                return Results.Ok(Describe(entry, restore));
            }
            catch (BackupUploadException ex)
            {
                return Results.Problem(ex.Message, statusCode: ex.Status, title: "Couldn't use that file");
            }
            catch (BadHttpRequestException ex) when (ex.StatusCode == StatusCodes.Status413PayloadTooLarge)
            {
                // The file said up front it was too big, so the server stopped it before a byte was counted here
                return Results.Problem($"That file is bigger than {maxBytes / (1024 * 1024)} MB, so it can't be used. Nothing was changed",
                    statusCode: StatusCodes.Status413PayloadTooLarge, title: "Too big");
            }
            catch (BadHttpRequestException)
            {
                return Results.Problem("The file didn't arrive whole. Try again", statusCode: StatusCodes.Status400BadRequest,
                    title: "Couldn't read it");
            }
            finally
            {
                try { File.Delete(temp); } catch (IOException) { } catch (UnauthorizedAccessException) { }
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
        b.Id, b.CreatedAt, b.Kind, b.By, b.MainSize, b.CollectorSize, b.RulesVersion, b.HasExcel, b.RowCount, b.UploadedAt,
        // Only a signed backup can be downloaded and dropped back in. Older ones still restore from this list.
        Signed = b.Signed,
        SameLayout = restore.SameLayout(b)
    };
}
