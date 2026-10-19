using api_v2.Application.Backups;
using api_v2.Application.Exceptions;
using api_v2.Application.Auth;
using api_v2.Presentation.Contracts;
using api_v2.Application.Ports;
using api_v2.Application.Health;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Net.Http.Headers;

using api_v2.Presentation.Authorization;
using api_v2.Application.Settings;

namespace api_v2.Presentation.Endpoints;

public static class BackupEndpoints
{
    public static void MapBackups(this WebApplication app)
    {
        // Managers and admins (decided 2026-10-09): a manager can take, download, upload and restore backups,
        // because restoring is how a team gets its tables back. Rules, History and Settings stay admin only.
        var group = app.MapGroup("/backups").RequireDatabaseReady().RequireManager();

        group.MapGet("/", (IBackupService backups, IBackupRestore restore) => Results.Ok(new
        {
            backups = backups.List().Select(b => Describe(b, restore)),
            status = backups.Status()
        }));

        group.MapPost("/", async (IBackupService backups, IBackupRestore restore, ICurrentUser user, ILogger<IBackupService> log, CancellationToken ct) =>
        {
            try
            {
                var made = await backups.RunAsync("manual", user.Name, ct);
                if (made is null)
                {
                    return Results.Problem("Nothing has changed from the previous backup. No new save was made.",
                        statusCode: StatusCodes.Status409Conflict, title: "No new save");
                }
                return Results.Ok(Describe(made, restore));
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
                    $"The backup didn't finish. {backups.PlainMessage(ex)}",
                    statusCode: StatusCodes.Status503ServiceUnavailable,
                    title: "Backup didn't finish");
            }
        });

        // Admins only: a deleted backup can't be brought back
        group.MapDelete("/{id}", (string id, IBackupService backups) =>
        {
            try
            {
                backups.Delete(id);
                return Results.NoContent();
            }
            catch (BackupBusyException ex)
            {
                return Results.Conflict(ex.Message);
            }
            catch (BackupUploadException ex)
            {
                return Results.Problem(ex.Message, statusCode: ex.Status, title: "Couldn't delete it");
            }
        }).RequireAdmin();

        // What a restore from this backup would do. Nothing is changed.
        group.MapGet("/{id}/restore/preview", async (string id, BackupPreview preview, CancellationToken ct) =>
            await preview.RestoreAsync(id, ct) is { } plan
                ? Results.Ok(plan)
                : Results.NotFound($"No backup called {id} exists. Nothing was changed"));

        // Puts the table, its rules, settings, requests and every table from the Tables page back the way they were
        // in this backup. Accounts and sign ins stay as they are now. A full backup of right now is taken first
        // (UndoBackup in the answer), and the industries as they are now are saved to History too.
        group.MapPost("/{id}/restore", async (string id, RestoreBackupBody body, IBackupRestore restore, DatabaseStatus status,
            ICurrentUser user, ILogger<IBackupRestore> log, CancellationToken ct) =>
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
                return Results.Problem(restore.PlainMessage(ex),
                    statusCode: StatusCodes.Status503ServiceUnavailable, title: "Restore didn't finish");
            }
        });

        // The whole backup as one signed zip, to keep somewhere else and drop back in later
        group.MapGet("/{id}/download", (string id, IBackupService backups) =>
        {
            if (!backups.ValidId(id)) return Results.BadRequest("That isn't a backup");
            // Deleted as soon as it has been sent
            var stream = backups.OpenZip(id);
            if (stream is null) return Results.NotFound($"No backup called {id} exists. Nothing was changed");
            return Results.File(stream, "application/zip", $"backup-{id}.zip");
        });

        // A backup zip dropped in from the page. It is checked and added to the list; restoring it is a separate step.
        // Read as it arrives, with the size cap counted on the way in, so a huge file never fills the disk.
        group.MapPost("/upload", async (HttpRequest request, IBackupService backups, IBackupRestore restore, BackupUploadLimit limit,
            ICurrentUser user, ILogger<IBackupService> log, CancellationToken ct) =>
        {
            var maxBytes = Math.Max(1, limit.MaxUploadMb) * 1024L * 1024L;
            if (!MediaTypeHeaderValue.TryParse(request.ContentType, out var media)
                || !media.MediaType.Equals("multipart/form-data", StringComparison.OrdinalIgnoreCase)
                || HeaderUtilities.RemoveQuotes(media.Boundary).Value is not { Length: > 0 } boundary)
            {
                return Results.Problem("Send the backup as a .zip file", statusCode: StatusCodes.Status400BadRequest, title: "That request couldn't be read. Nothing was changed");
            }

            var bodyLimit = request.HttpContext.Features.Get<IHttpMaxRequestBodySizeFeature>();
            if (bodyLimit is { IsReadOnly: false }) bodyLimit.MaxRequestBodySize = maxBytes + 1024 * 1024;

            using var upload = backups.BeginUpload();
            try
            {
                var reader = new MultipartReader(boundary, request.Body);
                MultipartSection? section;
                var got = false;
                while ((section = await reader.ReadNextSectionAsync(ct)) is not null)
                {
                    if (!ContentDispositionHeaderValue.TryParse(section.ContentDisposition, out var disposition)
                        || !disposition.IsFileDisposition()) continue;

                    await using (var target = upload.OpenWrite())
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
                    return Results.Problem("No file was sent", statusCode: StatusCodes.Status400BadRequest, title: "That request couldn't be read. Nothing was changed");
                }

                var entry = await upload.ImportAsync(user.Name, maxBytes, ct);
                return Results.Ok(Describe(entry, restore));
            }
            catch (BackupUploadException ex)
            {
                // existingId lets the page scroll to the backup that is already in the list
                var extensions = ex.ExistingId is null ? null : new Dictionary<string, object?> { ["existingId"] = ex.ExistingId };
                return Results.Problem(ex.Message, statusCode: ex.Status, title: "Couldn't use that file", extensions: extensions);
            }
            catch (BadHttpRequestException ex) when (ex.StatusCode == StatusCodes.Status413PayloadTooLarge)
            {
                // The file said up front it was too big, so the server stopped it before a byte was counted here
                return Results.Problem($"That file is bigger than {maxBytes / (1024 * 1024)} MB, so it can't be used. Nothing was changed",
                    statusCode: StatusCodes.Status413PayloadTooLarge, title: "Too big");
            }
            catch (BadHttpRequestException)
            {
                return Results.Problem("The upload was cut short. Nothing was added. Try again", statusCode: StatusCodes.Status400BadRequest,
                    title: "That request couldn't be read. Nothing was changed");
            }
        });

        group.MapGet("/{id}/{file}", async (string id, string file, IBackupService backups, CancellationToken ct) =>
        {
            // The file is sealed on disk, so it is opened there and sent in plain. excel is a CSV with a BOM, Excel opens it with a double click
            return await backups.OpenFileAsync(id, file, ct) switch
            {
                BackupFileOpen.Found found => file == "excel"
                    ? Results.Stream(found.Stream, "text/csv", $"industries-{id}.csv")
                    : Results.Stream(found.Stream, "application/octet-stream", $"{id}-{file}.dump"),
                BackupFileOpen.Missing => Results.NotFound($"No backup called {id} exists. Nothing was changed"),
                _ => Results.BadRequest("That isn't a backup file")
            };
        });
    }

    // What the page sees about one backup. SameLayout says if Restore is possible from the page.
    private static object Describe(BackupEntry b, IBackupRestore restore) => new
    {
        b.Id, b.CreatedAt, b.Kind, b.By, b.MainSize, b.CollectorSize, b.RulesVersion, b.HasExcel, b.RowCount, b.UploadedAt,
        // Only a signed backup can be downloaded and dropped back in. Older ones still restore from this list.
        Signed = b.Signed,
        SameLayout = restore.SameLayout(b)
    };
}
