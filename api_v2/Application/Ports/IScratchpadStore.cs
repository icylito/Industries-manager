using api_v2.Domain.Entities;

namespace api_v2.Application.Ports;

// One board as the History tab lists it: its own columns and how many things are on it, counted by the database
public record ScratchBoardSummary(int Id, string Name, bool Pinned, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt, int Things);

// The id, name and pinned flag a rename, a pin or a moved view answers with
public record ScratchBoardBrief(int Id, string Name, bool Pinned);

// A person's Scratchpad: their boards and their carry tray. Every query carries the person as well as the id,
// because someone else's board must answer the same as one that isn't there.
public interface IScratchpadStore
{
    // The History tab: pinned first, then the most recently changed. The thing count is counted in SQL, so no
    // board document comes down for a list.
    Task<IReadOnlyList<ScratchBoardSummary>> SummariesAsync(int person, CancellationToken ct);

    Task<int> CountBoardsAsync(int person, CancellationToken ct);

    // Tracked, because a save and a delete change the board they read
    Task<ScratchBoard?> FindAsync(int id, int person, CancellationToken ct);

    // Untracked: reading one board for the page never saves it back
    Task<ScratchBoard?> ReadAsync(int id, int person, CancellationToken ct);

    void Add(ScratchBoard board);

    // Whether the board is still there, before a patch touches one column at a time
    Task<bool> ExistsAsync(int id, int person, CancellationToken ct);

    // Each of these touches one column and never the document
    Task RenameAsync(int id, int person, string name, CancellationToken ct);

    Task PinAsync(int id, int person, bool pinned, CancellationToken ct);

    Task MoveViewAsync(int id, int person, string view, CancellationToken ct);

    // The board's id, name and pinned flag after those updates, without its document
    Task<ScratchBoardBrief> BriefAsync(int id, int person, CancellationToken ct);

    void Remove(ScratchBoard board);

    Task SaveAsync(CancellationToken ct);

    // The carry tray: tracked when it is about to change, untracked when it is only being read
    Task<ScratchTray?> FindTrayAsync(int person, CancellationToken ct);

    Task<ScratchTray?> ReadTrayAsync(int person, CancellationToken ct);

    void Add(ScratchTray tray);
}
