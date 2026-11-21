namespace api_v2.Application.Ports;

// The readable JSON copy of every table from the Tables page, written next to the database for people to look at.
// The database is the real storage, so this never feeds data back into the API.
public interface IUserTableMirror
{
    // After a change is saved: a burst of edits to one table writes its file once, a moment later
    void Changed(int tableId);

    Task RebuildAsync(CancellationToken ct);

    Task RemovedAsync(int tableId, CancellationToken ct);
}
