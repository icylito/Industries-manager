using api_v2.Application.Ports;

namespace api_v2.Application.Jobs;

// Taking a file off a board only drops the board's reference to it, so undo can bring the card back. This job
// cleans up after that: it notes which uploaded files no board of their owner uses, and deletes a file for good
// once it has gone unused for 7 days. The 7 days count from when it was first found unused, not from the upload,
// so a picture taken off today is still there for an undo in a tab left open all week.
// A file any of the person's boards still uses is never touched. Infrastructure/Hosted/ScratchFileSweeper runs it
// every hour.
public sealed class ScratchFileSweep(IScratchFilesStore store, IAppLocks locks, ILogger<ScratchFileSweep> log)
{
    public static readonly TimeSpan Grace = TimeSpan.FromDays(7);

    public async Task RunAsync(DateTimeOffset now, CancellationToken ct)
    {
        var people = await store.OwnersAsync(ct);
        foreach (var person in people) await SweepPersonAsync(person, now, ct);
    }

    private async Task SweepPersonAsync(int person, DateTimeOffset now, CancellationToken ct)
    {
        // The same lock a board save takes, so a save that adds a file card can't slip between the look and the delete
        await using var personLock = await locks.TakeAsync(AppLock.Scratchpad, person, ct);

        var expired = await store.MarkAndFindExpiredAsync(person, now, Grace, ct);
        // The bytes go with the row
        foreach (var file in expired) await store.DeleteAsync(file.Id, ct);
        if (expired.Count > 0) log.LogInformation("Deleted {Count} Scratchpad file(s) no board had used for 7 days", expired.Count);
    }
}
