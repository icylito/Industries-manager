using api_v2.Domain.Entities;

namespace api_v2.Application.Ports;

// An uploaded file that no board of its owner uses any more and is past the grace time
public record ScratchFileExpired(int Id);

// The files uploaded to the Scratchpad, rows and bytes both in the database: who has files, which ones are
// unused, and the rows an upload and a delete add or remove. Deleting a row deletes its bytes too.
public interface IScratchFilesStore
{
    Task<IReadOnlyList<int>> OwnersAsync(CancellationToken ct);

    // Marks files back on a board as used, newly unused files as orphaned from now, and answers the ones
    // that have been unused for longer than the grace time
    Task<IReadOnlyList<ScratchFileExpired>> MarkAndFindExpiredAsync(
        int person, DateTimeOffset now, TimeSpan grace, CancellationToken ct);

    Task DeleteAsync(int fileId, CancellationToken ct);

    // One row by id, tracked because a delete changes the row it read. The bytes are not loaded.
    Task<ScratchFile?> FindAsync(int id, CancellationToken ct);

    // The file's bytes, or null when the row has none (an old file the import couldn't find on disk)
    Task<byte[]?> ReadContentAsync(int fileId, CancellationToken ct);

    void Add(ScratchFile file);

    void Remove(ScratchFile file);

    // The row and its bytes are written together, so a failure leaves neither
    Task SaveAsync(CancellationToken ct);
}
