namespace api_v2.Application.Ports;

// An uploaded file that no board of its owner uses any more and is past the grace time
public record ScratchFileExpired(int Id, string StoredName);

// The file rows uploaded to the Scratchpad: who has files, which ones are unused, and deleting one for good
public interface IScratchFilesStore
{
    Task<IReadOnlyList<int>> OwnersAsync(CancellationToken ct);

    // Marks files back on a board as used, newly unused files as orphaned from now, and answers the ones
    // that have been unused for longer than the grace time
    Task<IReadOnlyList<ScratchFileExpired>> MarkAndFindExpiredAsync(
        int person, DateTimeOffset now, TimeSpan grace, CancellationToken ct);

    Task DeleteAsync(int fileId, CancellationToken ct);
}
