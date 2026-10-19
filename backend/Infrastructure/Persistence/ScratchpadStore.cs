using api_v2.Application.Ports;
using api_v2.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace api_v2.Infrastructure.Persistence;

// A person's Scratchpad boards and carry tray, through EF. The board's document is one JSON column, so the History
// tab's thing count is counted by Postgres and a list never pulls a document down.
public class ScratchpadStore(AppDbContext db) : IScratchpadStore
{
    public async Task<IReadOnlyList<ScratchBoardSummary>> SummariesAsync(int person, CancellationToken ct) =>
        await db.Database.SqlQuery<ScratchBoardSummary>($"""
            SELECT "Id", "Name", "Pinned", "CreatedAt", "UpdatedAt",
                   jsonb_array_length(COALESCE("Document"->'items', '[]'::jsonb)) AS "Things"
            FROM "ScratchBoards" WHERE "UserId" = {person}
            ORDER BY "Pinned" DESC, "UpdatedAt" DESC, "Id" DESC
            """).ToListAsync(ct);

    public Task<int> CountBoardsAsync(int person, CancellationToken ct) =>
        db.ScratchBoards.CountAsync(b => b.UserId == person, ct);

    public Task<ScratchBoard?> FindAsync(int id, int person, CancellationToken ct) =>
        db.ScratchBoards.FirstOrDefaultAsync(b => b.Id == id && b.UserId == person, ct);

    public async Task<ScratchBoard?> ReadAsync(int id, int person, CancellationToken ct) =>
        await db.ScratchBoards.AsNoTracking().FirstOrDefaultAsync(b => b.Id == id && b.UserId == person, ct);

    public void Add(ScratchBoard board) => db.ScratchBoards.Add(board);

    public Task<bool> ExistsAsync(int id, int person, CancellationToken ct) =>
        db.ScratchBoards.AnyAsync(b => b.Id == id && b.UserId == person, ct);

    // Each of these runs as its own UPDATE of one column, never touching the document
    public Task RenameAsync(int id, int person, string name, CancellationToken ct) =>
        db.ScratchBoards.Where(b => b.Id == id && b.UserId == person)
            .ExecuteUpdateAsync(s => s.SetProperty(b => b.Name, name), ct);

    public Task PinAsync(int id, int person, bool pinned, CancellationToken ct) =>
        db.ScratchBoards.Where(b => b.Id == id && b.UserId == person)
            .ExecuteUpdateAsync(s => s.SetProperty(b => b.Pinned, pinned), ct);

    public Task MoveViewAsync(int id, int person, string view, CancellationToken ct) =>
        db.ScratchBoards.Where(b => b.Id == id && b.UserId == person)
            .ExecuteUpdateAsync(s => s.SetProperty(b => b.View, view), ct);

    public async Task<ScratchBoardBrief> BriefAsync(int id, int person, CancellationToken ct)
    {
        var row = await db.ScratchBoards.AsNoTracking()
            .Where(b => b.Id == id && b.UserId == person)
            .Select(b => new { b.Id, b.Name, b.Pinned })
            .FirstAsync(ct);
        return new ScratchBoardBrief(row.Id, row.Name, row.Pinned);
    }

    public void Remove(ScratchBoard board) => db.ScratchBoards.Remove(board);

    public Task SaveAsync(CancellationToken ct) => db.SaveChangesAsync(ct);

    public Task<ScratchTray?> FindTrayAsync(int person, CancellationToken ct) =>
        db.ScratchTrays.FirstOrDefaultAsync(t => t.UserId == person, ct);

    public async Task<ScratchTray?> ReadTrayAsync(int person, CancellationToken ct) =>
        await db.ScratchTrays.AsNoTracking().FirstOrDefaultAsync(t => t.UserId == person, ct);

    public void Add(ScratchTray tray) => db.ScratchTrays.Add(tray);
}
