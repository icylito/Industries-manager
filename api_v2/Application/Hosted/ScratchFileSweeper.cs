using api_v2.Application.Health;
using api_v2.Application.Hosted;
using api_v2.Infrastructure.Files;
using api_v2.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using api_v2.Application.Ports;

namespace api_v2.Application.Hosted;

// Taking a file off a board only drops the board's reference to it, so undo can bring the card back. This job
// cleans up after that: every hour it notes which uploaded files no board of their owner uses, and deletes a file
// for good once it has gone unused for 7 days. The 7 days count from when it was first found unused, not from
// the upload, so a picture taken off today is still there for an undo in a tab left open all week.
// A file any of the person's boards still uses is never touched.
public sealed class ScratchFileSweeper(
    IServiceScopeFactory scopes,
    DatabaseStatus status,
    AppLocks locks,
    ScratchFileStore store,
    IConfiguration config,
    ILogger<ScratchFileSweeper> log) : BackgroundService
{
    public static readonly TimeSpan Grace = TimeSpan.FromDays(7);

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        if (!await status.WaitUntilReadyAsync(ct)) return;

        // Hourly. The throwaway API used by the checks in testing/ sets Scratchpad:SweepMinutes lower.
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(Math.Max(1, config.GetValue("Scratchpad:SweepMinutes", 60))));
        do
        {
            try
            {
                await SweepAsync(DateTimeOffset.UtcNow, ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogWarning(ex, "Tidying the Scratchpad files failed, it's tried again later");
            }
        } while (await timer.WaitForNextTickAsync(ct));
    }

    public async Task SweepAsync(DateTimeOffset now, CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var people = await db.ScratchFiles.Select(f => f.UserId).Distinct().ToListAsync(ct);
        foreach (var person in people) await SweepPersonAsync(db, person, now, ct);
    }

    private async Task SweepPersonAsync(AppDbContext db, int person, DateTimeOffset now, CancellationToken ct)
    {
        // The same lock a board save takes, so a save that adds a file card can't slip between the look and the delete
        await using var personLock = await locks.TakeAsync(AppLock.Scratchpad, person, ct);

        var used = await db.Database.SqlQuery<int>($"""
            SELECT DISTINCT (item->>'fileId')::numeric::int AS "Value"
            FROM "ScratchBoards" b, jsonb_array_elements(COALESCE(b."Document"->'items', '[]'::jsonb)) item
            WHERE b."UserId" = {person} AND item->>'type' = 'file' AND jsonb_typeof(item->'fileId') = 'number'
            """).ToListAsync(ct);

        var files = db.ScratchFiles.Where(f => f.UserId == person);
        // Back on a board: not unused any more
        await files.Where(f => f.OrphanedAt != null && used.Contains(f.Id))
            .ExecuteUpdateAsync(s => s.SetProperty(f => f.OrphanedAt, (DateTimeOffset?)null), ct);
        // Newly unused: the 7 days start now
        await files.Where(f => f.OrphanedAt == null && !used.Contains(f.Id))
            .ExecuteUpdateAsync(s => s.SetProperty(f => f.OrphanedAt, now), ct);

        var cutoff = now - Grace;
        var expired = await files
            .Where(f => f.OrphanedAt != null && f.OrphanedAt < cutoff && f.CreatedAt < cutoff && !used.Contains(f.Id))
            .Select(f => new { f.Id, f.StoredName }).ToListAsync(ct);
        foreach (var file in expired)
        {
            await db.ScratchFiles.Where(f => f.Id == file.Id).ExecuteDeleteAsync(ct);
            // The row goes first: a file left on disk is litter, a row left without its file would be a broken card
            store.Delete(file.StoredName);
        }
        if (expired.Count > 0) log.LogInformation("Deleted {Count} Scratchpad file(s) no board had used for 7 days", expired.Count);
    }
}
