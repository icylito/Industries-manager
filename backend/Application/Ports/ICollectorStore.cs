using System.Text.Json;
using api_v2.Domain.Collector;

namespace api_v2.Application.Ports;

// Which rows were added or edited by hand lately, read from the change log in the collector database
public record ActivityRow(int RowId, DateTimeOffset? Added, DateTimeOffset? Edited);

// Damaged means a saved value in the collector couldn't be read (edited by hand, or a format that changed).
// The version still shows in the list but can't be restored or imported.
public record VersionSummary(long Id, DateTimeOffset CreatedAt, string Reason, string CreatedBy, int RowCount,
    int? RulesVersion, bool Pinned, List<string> Migrations, bool Damaged = false);

// What deleting one saved version came to. A pinned one stays until it is unpinned.
public enum VersionRemoval { Removed, NotFound, Pinned }

// One saved version with everything in it, what View, Download, Restore and Import read
public record VersionDetail(VersionSummary Summary, List<VersionColumn> Columns, string? Rules, List<JsonElement> Rows);

public record VersionColumn(string Name, string Type, bool Nullable);

// The collector database: copies of old versions and the log of every change made to the live table
public interface ICollectorStore
{
    // The message /health shows while the history database can't be reached
    const string UnreachableMessage = "The history database (collector) isn't reachable";

    // A quick look at the collector, true when it answers and its tables are there
    Task<bool> PingAsync(CancellationToken ct);

    // Looks at a failure from any collector call, and marks history offline when the database itself is down
    bool NoteFailure(Exception ex);

    // True when a failure means the history routes can't answer at all: the collector's tables aren't there yet,
    // or the database isn't answering. Narrower than NoteFailure, which also marks the badge down for a refused sign in.
    bool IsDown(Exception ex);

    // Edits and deletes log first as "pending", then get marked "done" or "failed" once the change ran.
    // If this throws, the caller doesn't make the change, so nothing is lost without a copy.
    Task<long> LogChangeAsync(int? rowId, string action, object? before, object? after,
        int? rulesVersion, string changedBy, string status = "pending", CancellationToken ct = default);

    Task FinishChangeAsync(long changeId, bool done, int? rowId = null, object? after = null, CancellationToken ct = default);

    // Saves a full copy of the live table. The rules save takes this first, so no version can be lost.
    Task<long?> SaveVersionAsync(string reason, string createdBy, CancellationToken ct = default, bool applyRetention = true);

    // Takes back a copy that was saved for a change that didn't happen. Best effort, a leftover copy is only clutter.
    Task DeleteVersionAsync(long id);

    // Every saved version, newest first
    Task<List<VersionSummary>> ListVersionsAsync(CancellationToken ct = default);

    // One version with its columns, its rules and its rows, or null when there is no such version
    Task<VersionDetail?> GetVersionAsync(long id, CancellationToken ct = default);

    // True when the version was there, so a pin or unpin of a version that isn't answers the same as a missing one
    Task<bool> SetPinnedAsync(long id, bool pinned, CancellationToken ct = default);

    // Deletes one version for good. A pinned one stays and says so, and a missing one says that.
    Task<VersionRemoval> RemoveVersionAsync(long id, CancellationToken ct = default);

    // How many versions these settings would remove, nothing gets deleted. The page asks before saving.
    Task<int> CountRemovableAsync(Retention retention, int newCopies = 0, CancellationToken ct = default);

    // Removes versions past the retention settings, never pinned ones. Returns how many went.
    // keepVersionId is treated like a pinned version for this run (the version a restore or import came from)
    Task<int> ApplyRetentionAsync(CancellationToken ct = default, long? keepVersionId = null);

    // Retention after a restore or import, the version the rows came from always stays
    Task ApplyRetentionQuietlyAsync(long? keepVersionId, CancellationToken ct);

    // Import adds many rows at once, they get logged in one go after the import went through
    Task LogImportsAsync(IEnumerable<(int RowId, object After)> rows, int rulesVersion, string changedBy, CancellationToken ct = default);

    // Which rows were added or edited by hand lately, for the New and Updated tags
    Task<IReadOnlyList<ActivityRow>> RecentActivityAsync(int days, CancellationToken ct);
}
