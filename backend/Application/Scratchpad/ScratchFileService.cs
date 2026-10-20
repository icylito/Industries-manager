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

// Uploaded Scratchpad files. The row says who owns a file and what the card shows, the bytes sit beside it in the
// database, so nothing about a file lives in the API's folder.
// Files are per person, like the board they sit on: every call takes the person and only ever finds their own
// files, so one admin cannot read or delete another's, and widening the page later does not widen who can.
public sealed class ScratchFileService(IScratchFilesStore rows)
{
    // Reads the bytes up to the cap, then writes the row and the bytes in one save
    public async Task<SaveFileResult> SaveAsync(int person, string fileName, string? contentType, Stream body, CancellationToken ct)
    {
        var display = ScratchFileRules.DisplayName(fileName);
        var bytes = await ReadUpToAsync(body, ScratchFileRules.MaxBytes, ct);
        if (bytes is null) return new SaveFileResult.TooBig(ScratchFileRules.TooBig(display));

        var row = new ScratchFile
        {
            UserId = person,
            Name = display,
            ContentType = ScratchFileRules.ContentTypeOf(contentType),
            SizeBytes = bytes.Length,
            StoredName = ScratchFileRules.StoredNameFor(ScratchFileRules.ExtensionOf(fileName)),
            CreatedAt = DateTimeOffset.UtcNow,
            Content = new ScratchFileContent { Bytes = bytes },
        };
        rows.Add(row);
        await rows.SaveAsync(ct);
        return new SaveFileResult.Saved(new ScratchFileInfo(row.Id, row.Name, row.ContentType, row.SizeBytes));
    }

    // The person's own file, opened to stream back, or null when there's none they own
    public async Task<OpenedFile?> OpenAsync(int id, int? person, CancellationToken ct)
    {
        var file = await rows.FindAsync(id, ct);
        if (file is null || file.UserId != person) return null;
        var bytes = await rows.ReadContentAsync(file.Id, ct);
        return bytes is null
            ? null
            : new OpenedFile(new MemoryStream(bytes, writable: false), file.Name, file.ContentType, ScratchFileRules.ShowsInline(file.ContentType));
    }

    // Removes the row, and its bytes go with it. False when there's no such file of theirs.
    public async Task<bool> DeleteAsync(int id, int? person, CancellationToken ct)
    {
        var file = await rows.FindAsync(id, ct);
        if (file is null || file.UserId != person) return false;

        rows.Remove(file);
        await rows.SaveAsync(ct);
        return true;
    }

    // The whole content, or null when it is longer than `limit`. Reading stops one buffer past the cap, so a file
    // far over it is never held in memory.
    private static async Task<byte[]?> ReadUpToAsync(Stream content, long limit, CancellationToken ct)
    {
        using var kept = new MemoryStream();
        var buffer = new byte[81920];
        int read;
        while ((read = await content.ReadAsync(buffer, ct)) > 0)
        {
            if (kept.Length + read > limit) return null;
            kept.Write(buffer, 0, read);
        }
        return kept.ToArray();
    }
}
