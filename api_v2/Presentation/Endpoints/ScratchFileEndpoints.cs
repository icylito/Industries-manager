using api_v2.Application.Health;
using api_v2.Infrastructure.Files;
using api_v2.Infrastructure.Persistence;
using api_v2.Domain.Entities;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Net.Http.Headers;
using api_v2.Application.Ports;

namespace api_v2.Presentation.Endpoints;

// Uploaded Scratchpad files. The bytes live on disk, the row says who owns them and what the card shows.
// Admin only today (the Scratchpad is admin only), and every handler also checks the owner, so one admin cannot
// read or delete another's files, and widening the page later does not widen who can.
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

    // On the Scratchpad's own group, see ScratchpadEndpoints, so the same checks guard boards and files
    public static void MapScratchFiles(this RouteGroupBuilder group)
    {
        // Upload one file. Multipart, one file per call, so a refusal names exactly one file.
        // The body is read part by part rather than as a whole form: the file's name arrives before its bytes,
        // so a refused kind is answered before anything is read, and a file over the cap is stopped at the cap
        // and still named in the answer, however big it is.
        group.MapPost("/files", async (HttpRequest request, AppDbContext db, ICurrentUser user,
            ScratchFileStore store, CancellationToken ct) =>
        {
            var boundary = BoundaryOf(request.ContentType);
            if (boundary is null)
            {
                return Results.Problem("Send the file as a form", statusCode: StatusCodes.Status400BadRequest,
                    title: "Couldn't read it");
            }

            // The server's own body limit (about 28.6 MB) would cut in before the cap below and lose the name,
            // so this call reads up to its own cap and stops there itself
            var bodyLimit = request.HttpContext.Features.Get<IHttpMaxRequestBodySizeFeature>();
            if (bodyLimit is { IsReadOnly: false }) bodyLimit.MaxRequestBodySize = null;

            var reader = new MultipartReader(boundary, request.Body);
            var display = "The file";
            try
            {
                MultipartSection? section;
                while ((section = await reader.ReadNextSectionAsync(ct)) is not null)
                {
                    if (!ContentDispositionHeaderValue.TryParse(section.ContentDisposition, out var disposition)
                        || !disposition.IsFileDisposition())
                    {
                        continue;
                    }

                    var fileName = HeaderUtilities.RemoveQuotes(
                        disposition.FileNameStar.HasValue ? disposition.FileNameStar : disposition.FileName).Value ?? "";
                    display = DisplayName(fileName);
                    var extension = ExtensionOf(fileName);
                    // A kind that is never allowed is refused before any of it is read, so a huge Office file
                    // still gets the Office line
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

                    var storedName = StoredNameFor(extension);
                    long size;
                    try
                    {
                        size = await store.WriteAsync(storedName, section.Body, MaxBytes, ct);
                    }
                    catch (Exception ex) when (ex is not BadHttpRequestException && ex is IOException or UnauthorizedAccessException)
                    {
                        return Results.Problem("The file couldn't be saved. Try again in a moment",
                            statusCode: StatusCodes.Status503ServiceUnavailable, title: "Couldn't save it");
                    }
                    if (size < 0) return TooBig(display);

                    var row = new ScratchFile
                    {
                        UserId = user.Id!.Value,
                        Name = display,
                        ContentType = ContentTypeOf(section.ContentType),
                        SizeBytes = size,
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
                }
            }
            catch (BadHttpRequestException)
            {
                // The connection broke off or the body was malformed partway through the file
                return Results.Problem($"{display} didn't arrive whole. Try again", statusCode: StatusCodes.Status400BadRequest,
                    title: "Couldn't read it");
            }
            catch (InvalidDataException)
            {
                return Results.Problem("Send the file as a form", statusCode: StatusCodes.Status400BadRequest,
                    title: "Couldn't read it");
            }

            return Results.Problem("No file was sent", statusCode: StatusCodes.Status400BadRequest,
                title: "Couldn't read it");
        });

        // Stream one file back. Only the person who uploaded it may read it.
        group.MapGet("/files/{id:int}", async (int id, HttpContext http, AppDbContext db, ICurrentUser user,
            ScratchFileStore store, CancellationToken ct) =>
        {
            var file = await db.ScratchFiles.AsNoTracking().FirstOrDefaultAsync(f => f.Id == id, ct);
            if (file is null || !IsOwner(user, file)) return FileNotFound();

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
            if (file is null || !IsOwner(user, file)) return FileNotFound();

            db.ScratchFiles.Remove(file);
            await db.SaveChangesAsync(ct);
            // The row is gone, so a stubborn disk file is litter, not something the API can still serve
            store.Delete(file.StoredName);
            return Results.Ok(new { deleted = 1, id });
        });
    }

    // Files are per person, like the board they sit on. Being an admin is what lets someone reach these
    // endpoints at all, so it must not also unlock everyone else's files
    private static bool IsOwner(ICurrentUser user, ScratchFile file) => user.Id == file.UserId;

    // The boundary from a multipart Content-Type, or null when the body is not multipart
    private static string? BoundaryOf(string? contentType)
    {
        if (!MediaTypeHeaderValue.TryParse(contentType, out var media)
            || !media.MediaType.Equals("multipart/form-data", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }
        var boundary = HeaderUtilities.RemoveQuotes(media.Boundary).Value;
        return string.IsNullOrWhiteSpace(boundary) ? null : boundary;
    }

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
