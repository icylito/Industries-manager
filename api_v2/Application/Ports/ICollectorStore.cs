namespace api_v2.Application.Ports;

// Which rows were added or edited by hand lately, read from the change log in the collector database
public record ActivityRow(int RowId, DateTimeOffset? Added, DateTimeOffset? Edited);

// The collector database: copies of old versions and the log of every change made to the live table
public interface ICollectorStore
{
    // Looks at a failure from any collector call, and marks history offline when the database itself is down
    bool NoteFailure(Exception ex);

    // Edits and deletes log first as "pending", then get marked "done" or "failed" once the change ran.
    // If this throws, the caller doesn't make the change, so nothing is lost without a copy.
    Task<long> LogChangeAsync(int? rowId, string action, object? before, object? after,
        int? rulesVersion, string changedBy, string status = "pending", CancellationToken ct = default);

    Task FinishChangeAsync(long changeId, bool done, int? rowId = null, object? after = null, CancellationToken ct = default);

    // Which rows were added or edited by hand lately, for the New and Updated tags
    Task<IReadOnlyList<ActivityRow>> RecentActivityAsync(int days, CancellationToken ct);
}
