using api_v2.Application.Ports;
using api_v2.Application.Scratchpad;
using api_v2.Domain.Scratchpad;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Net.Http.Headers;

namespace api_v2.Presentation.Endpoints;

// Uploaded Scratchpad files over HTTP: reading the multipart body and answering. What may be uploaded is
// Domain/Scratchpad/ScratchFileRules, saving and the owner check are Application/Scratchpad/ScratchFileService.
// Admin only today (the Scratchpad is admin only).
public static class ScratchFileEndpoints
{
    // On the Scratchpad's own group, see ScratchpadEndpoints, so the same checks guard boards and files
    public static void MapScratchFiles(this RouteGroupBuilder group)
    {
        // Upload one file. Multipart, one file per call, so a refusal names exactly one file.
        // The body is read part by part rather than as a whole form: the file's name arrives before its bytes,
        // so a refused kind is answered before anything is read, and a file over the cap is stopped at the cap
        // and still named in the answer, however big it is.
        group.MapPost("/files", async (HttpRequest request, ScratchFileService service, ICurrentUser user, CancellationToken ct) =>
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
                    display = ScratchFileRules.DisplayName(fileName);
                    if (ScratchFileRules.Refusal(fileName) is { } refusal) return Refused(refusal);

                    SaveFileResult saved;
                    try
                    {
                        saved = await service.SaveAsync(user.Id!.Value, fileName, section.ContentType, section.Body, ct);
                    }
                    catch (Exception ex) when (ex is not BadHttpRequestException && ex is IOException or UnauthorizedAccessException)
                    {
                        return Results.Problem("The file couldn't be saved. Try again in a moment",
                            statusCode: StatusCodes.Status503ServiceUnavailable, title: "Couldn't save it");
                    }
                    if (saved is SaveFileResult.TooBig tooBig) return TooBig(tooBig.Message);

                    var row = ((SaveFileResult.Saved)saved).File;
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
        group.MapGet("/files/{id:int}", async (int id, HttpContext http, ScratchFileService service, ICurrentUser user,
            CancellationToken ct) =>
        {
            var file = await service.OpenAsync(id, user.Id, ct);
            if (file is null) return FileNotFound();

            // Never let the browser guess what it is: an odd type must not run as a page
            http.Response.Headers["X-Content-Type-Options"] = "nosniff";
            if (!file.Inline) return Results.File(file.Stream, file.ContentType, fileDownloadName: file.Name);

            http.Response.Headers["Content-Disposition"] = "inline";
            return Results.File(file.Stream, file.ContentType);
        });

        // Remove the row and the bytes on disk.
        group.MapDelete("/files/{id:int}", async (int id, ScratchFileService service, ICurrentUser user, CancellationToken ct) =>
            await service.DeleteAsync(id, user.Id, ct) ? Results.Ok(new { deleted = 1, id }) : FileNotFound());
    }

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

    private static IResult TooBig(string message) =>
        Results.Problem(message, statusCode: StatusCodes.Status413PayloadTooLarge, title: "Too big");
}
