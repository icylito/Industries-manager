using api_v2.Application.Ports;
using api_v2.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace api_v2.Infrastructure.Persistence;

// The uploaded-file rows, through EF. Which files a board still uses is read from the board JSON in SQL.
public class ScratchFilesStore(AppDbContext db) : IScratchFilesStore
{
    public Task<ScratchFile?> FindAsync(int id, CancellationToken ct) =>
        db.ScratchFiles.FirstOrDefaultAsync(f => f.Id == id, ct);

    public void Add(ScratchFile file) => db.ScratchFiles.Add(file);

    public void Remove(ScratchFile file) => db.ScratchFiles.Remove(file);

    public Task SaveAsync(CancellationToken ct) => db.SaveChangesAsync(ct);

    public async Task<IReadOnlyList<int>> OwnersAsync(CancellationToken ct) =>
        await db.ScratchFiles.Select(f => f.UserId).Distinct().ToListAsync(ct);

    public async Task<IReadOnlyList<ScratchFileExpired>> MarkAndFindExpiredAsync(
        int person, DateTimeOffset now, TimeSpan grace, CancellationToken ct)
    {
        var used = await db.Database.SqlQuery<int>($"""
            SELECT DISTINCT (item->>'fileId')::numeric::int AS "Value"
            FROM "ScratchBoards" b, jsonb_array_elements(COALESCE(b."Document"->'items', '[]'::jsonb)) item
            WHERE b."UserId" = {person} AND item->>'type' = 'file' AND jsonb_typeof(item->'fileId') = 'number'
            """).ToListAsync(ct);

        var files = db.ScratchFiles.Where(f => f.UserId == person);
        // Back on a board: not unused any more
        await files.Where(f => f.OrphanedAt != null && used.Contains(f.Id))
            .ExecuteUpdateAsync(s => s.SetProperty(f => f.OrphanedAt, (DateTimeOffset?)null), ct);
        // Newly unused: the grace time starts now
        await files.Where(f => f.OrphanedAt == null && !used.Contains(f.Id))
            .ExecuteUpdateAsync(s => s.SetProperty(f => f.OrphanedAt, now), ct);

        var cutoff = now - grace;
        return await files
            .Where(f => f.OrphanedAt != null && f.OrphanedAt < cutoff && f.CreatedAt < cutoff && !used.Contains(f.Id))
            .Select(f => new ScratchFileExpired(f.Id, f.StoredName))
            .ToListAsync(ct);
    }

    public Task DeleteAsync(int fileId, CancellationToken ct) =>
        db.ScratchFiles.Where(f => f.Id == fileId).ExecuteDeleteAsync(ct);
}
