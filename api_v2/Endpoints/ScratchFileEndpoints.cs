using api_v2.Auth;
using api_v2.Data;
using api_v2.Model;
using Microsoft.EntityFrameworkCore;

namespace api_v2.Endpoints;

// Uploaded Scratchpad files. The bytes live on disk, the row says who owns them and what the card shows.
// Admin only today (the Scratchpad is admin only), and every handler also checks the owner, so widening the
// page later does not widen who can read someone else's file.
public static class ScratchFileEndpoints
{
    // The limit the page tells people about
    private const long MaxBytes = 25L * 1024 * 1024;
    private const int MaxName = 260;
    private const int MaxContentType = 120;

    // Everything the board refuses, by extension. The page shows the API's line verbatim in the toast, so the
    // wording here is the wording the person reads.
    private static readonly HashSet<string> OfficeExtensions =
        [".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx"];
    private static readonly HashSet<string> TextExtensions = [".txt", ".md"];
    private static readonly HashSet<string> ScriptExtensions =
        [".exe", ".bat", ".cmd", ".ps1", ".js", ".vbs", ".msi", ".dll", ".jar", ".scr"];

    public static void MapScratchFiles(this WebApplication app)
    {
        var group = app.MapGroup("/scratchpad").RequireDatabaseReady().RequireAdmin();

        // Upload one file. Multipart, one file per call, so a refusal names exactly one file.
        group.MapPost("/files", async (HttpRequest request, AppDbContext db, ICurrentUser user,
            ScratchFileStore store, CancellationToken ct) =>
        {
            if (!request.HasFormContentType)
            {
                return Results.Problem("Send the file as a form", statusCode: StatusCodes.Status400BadRequest,
                    title: "Couldn't read it");
            }

            IFormCollection form;
            try
            {
                form = await request.ReadFormAsync(ct);
            }
            catch (Exception ex) when (ex is InvalidDataException or BadHttpRequestException)
            {
                // The server refused the body before the name was readable, so answer with the same line
                return TooBig("The file");
            }

            var file = form.Files["file"] ?? form.Files.FirstOrDefault();
            if (file is null)
            {
                return Results.Problem("No file was sent", statusCode: StatusCodes.Status400BadRequest,
                    title: "Couldn't read it");
            }

            var display = DisplayName(file.FileName);
            var extension = ExtensionOf(file.FileName);
            // A kind that is never allowed is refused first, so a huge Office file still gets the Office line
            if (OfficeExtensions.Contains(extension))
            {
                return Refused($"Word, PowerPoint and Excel files can't go on the board ({display}).");
            }
            if (TextExtensions.Contains(extension))
            {
                return Refused($"Text files can't go on the board ({display}). Copy the text and paste it instead.");
            }
            if (ScriptExtensions.Contains(extension))
            {
                return Refused($"That kind of file can't go on the board ({display}).");
            }

            if (file.Length > MaxBytes) return TooBig(display);

            var storedName = StoredNameFor(extension);
            try
            {
                await using var source = file.OpenReadStream();
                await store.WriteAsync(storedName, source, ct);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                return Results.Problem("The file couldn't be saved. Try again in a moment",
                    statusCode: StatusCodes.Status503ServiceUnavailable, title: "Couldn't save it");
            }

            var row = new ScratchFile
            {
                UserId = user.Id!.Value,
                Name = display,
                ContentType = ContentTypeOf(file.ContentType),
                SizeBytes = file.Length,
                StoredName = storedName,
                CreatedAt = DateTimeOffset.UtcNow,
            };
            db.ScratchFiles.Add(row);
            try
            {
                await db.SaveChangesAsync(ct);
            }
            catch
            {
                // The row is the file's only handle, so take the bytes back off disk if the row cannot be saved
                store.Delete(storedName);
                throw;
            }

            return Results.Created($"/scratchpad/files/{row.Id}",
                new { id = row.Id, name = row.Name, contentType = row.ContentType, sizeBytes = row.SizeBytes });
        });

        // Stream one file back. Only the owner, or an admin, may read it.
        group.MapGet("/files/{id:int}", async (int id, HttpContext http, AppDbContext db, ICurrentUser user,
            ScratchFileStore store, CancellationToken ct) =>
        {
            var file = await db.ScratchFiles.AsNoTracking().FirstOrDefaultAsync(f => f.Id == id, ct);
            if (file is null || !MayRead(user, file)) return FileNotFound();

            var path = store.PathFor(file.StoredName);
            if (!File.Exists(path)) return FileNotFound();

            // Never let the browser guess what it is: an odd type must not run as a page
            http.Response.Headers["X-Content-Type-Options"] = "nosniff";

            var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
            var media = MediaTypeOf(file.ContentType);
            // Images and PDF render in place; everything else, SVG included, is offered as a download
            var inline = (media.StartsWith("image/", StringComparison.OrdinalIgnoreCase)
                    && !media.Contains("svg", StringComparison.OrdinalIgnoreCase))
                || media.Equals("application/pdf", StringComparison.OrdinalIgnoreCase);
            if (!inline) return Results.File(stream, file.ContentType, fileDownloadName: file.Name);

            http.Response.Headers["Content-Disposition"] = "inline";
            return Results.File(stream, file.ContentType);
        });

        // Remove the row and the bytes on disk.
        group.MapDelete("/files/{id:int}", async (int id, AppDbContext db, ICurrentUser user,
            ScratchFileStore store, CancellationToken ct) =>
        {
            var file = await db.ScratchFiles.FirstOrDefaultAsync(f => f.Id == id, ct);
            if (file is null || !MayRead(user, file)) return FileNotFound();

            db.ScratchFiles.Remove(file);
            await db.SaveChangesAsync(ct);
            // The row is gone, so a stubborn disk file is litter, not something the API can still serve
            store.Delete(file.StoredName);
            return Results.Ok(new { deleted = 1, id });
        });
    }

    private static bool MayRead(ICurrentUser user, ScratchFile file) => user.IsAdmin || user.Id == file.UserId;

    private static IResult FileNotFound() => Results.NotFound("There is no file with that id");

    private static IResult Refused(string message) =>
        Results.Problem(message, statusCode: StatusCodes.Status400BadRequest,
            title: "That kind of file can't go on the board");

    private static IResult TooBig(string name) =>
        Results.Problem($"{name} is bigger than 25 MB.", statusCode: StatusCodes.Status413PayloadTooLarge,
            title: "Too big");

    // The original name is only shown on the card, so keep the file's own name, never a path from the client
    private static string DisplayName(string fileName)
    {
        var name = Path.GetFileName(fileName);
        name = new string(name.Where(c => !char.IsControl(c)).ToArray()).Trim();
        if (name.Length == 0) return "File";
        return name.Length > MaxName ? name[..MaxName] : name;
    }

    private static string ExtensionOf(string fileName) => Path.GetExtension(fileName).ToLowerInvariant();

    // A GUID plus the original extension is the only name on disk, so uploads never collide and the original
    // name can never become a path
    private static string StoredNameFor(string extension)
    {
        var safe = new string(extension.Where(char.IsLetterOrDigit).ToArray());
        if (safe.Length > 10) safe = safe[..10];
        return safe.Length == 0 ? Guid.NewGuid().ToString("N") : $"{Guid.NewGuid():N}.{safe}";
    }

    private static string ContentTypeOf(string? contentType)
    {
        var type = string.IsNullOrWhiteSpace(contentType) ? "application/octet-stream" : contentType.Trim();
        return type.Length > MaxContentType ? type[..MaxContentType] : type;
    }

    private static string MediaTypeOf(string contentType) => contentType.Split(';')[0].Trim();
}
