using api_v2.Application.Ports;
using api_v2.Domain.Entities;
using api_v2.Domain.Scratchpad;

namespace api_v2.Application.Scratchpad;

public sealed record ScratchFileInfo(int Id, string Name, string ContentType, long SizeBytes);

public abstract record SaveFileResult
{
    public sealed record Saved(ScratchFileInfo File) : SaveFileResult;
    public sealed record TooBig(string Message) : SaveFileResult;
}

public sealed record OpenedFile(Stream Stream, string Name, string ContentType, bool Inline);

// Uploaded Scratchpad files. The bytes live on disk, the row says who owns them and what the card shows.
// Files are per person, like the board they sit on: every call takes the person and only ever finds their own
// files, so one admin cannot read or delete another's, and widening the page later does not widen who can.
public sealed class ScratchFileService(IScratchFilesStore rows, IScratchFiles files)
{
    // Writes the bytes, then the row. A disk that refuses the write throws IOException; the caller says so.
    public async Task<SaveFileResult> SaveAsync(int person, string fileName, string? contentType, Stream body, CancellationToken ct)
    {
        var display = ScratchFileRules.DisplayName(fileName);
        var storedName = ScratchFileRules.StoredNameFor(ScratchFileRules.ExtensionOf(fileName));
        var size = await files.WriteAsync(storedName, body, ScratchFileRules.MaxBytes, ct);
        if (size < 0) return new SaveFileResult.TooBig(ScratchFileRules.TooBig(display));

        var row = new ScratchFile
        {
            UserId = person,
            Name = display,
            ContentType = ScratchFileRules.ContentTypeOf(contentType),
            SizeBytes = size,
            StoredName = storedName,
            CreatedAt = DateTimeOffset.UtcNow,
        };
        rows.Add(row);
        try
        {
            await rows.SaveAsync(ct);
        }
        catch
        {
            // The row is the file's only handle, so take the bytes back off disk if the row cannot be saved
            files.Delete(storedName);
            throw;
        }
        return new SaveFileResult.Saved(new ScratchFileInfo(row.Id, row.Name, row.ContentType, row.SizeBytes));
    }

    // The person's own file, opened to stream back, or null when there's none they own
    public async Task<OpenedFile?> OpenAsync(int id, int? person, CancellationToken ct)
    {
        var file = await rows.FindAsync(id, ct);
        if (file is null || file.UserId != person) return null;
        var stream = files.OpenRead(file.StoredName);
        return stream is null ? null : new OpenedFile(stream, file.Name, file.ContentType, ScratchFileRules.ShowsInline(file.ContentType));
    }

    // Removes the row and the bytes on disk. False when there's no such file of theirs.
    public async Task<bool> DeleteAsync(int id, int? person, CancellationToken ct)
    {
        var file = await rows.FindAsync(id, ct);
        if (file is null || file.UserId != person) return false;

        rows.Remove(file);
        await rows.SaveAsync(ct);
        // The row is gone, so a stubborn disk file is litter, not something the API can still serve
        files.Delete(file.StoredName);
        return true;
    }
}
