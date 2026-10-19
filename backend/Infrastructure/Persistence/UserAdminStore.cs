using api_v2.Application.Ports;
using api_v2.Domain.Accounts;
using api_v2.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace api_v2.Infrastructure.Persistence;

// The account rows and the notes about them, through EF. The unit of work is the scoped AppDbContext:
// the use case picks the order of the calls, and every save in one request goes through the same context.
public class UserAdminStore(AppDbContext db) : IUserAdminStore
{
    // The notes' owners are read first, then the people, in the order the list endpoint asks for them
    public async Task<(IReadOnlyCollection<int> Noted, IReadOnlyList<User> People)> ListAsync(CancellationToken ct)
    {
        var noted = (await db.UserNotes.AsNoTracking().Select(n => n.UserId).Distinct().ToListAsync(ct)).ToHashSet();
        var people = await db.Users.AsNoTracking().OrderBy(u => u.Username).ToListAsync(ct);
        return (noted, people);
    }

    public async Task<IReadOnlyList<UserNote>> NotesAsync(int userId, CancellationToken ct) =>
        await db.UserNotes.AsNoTracking().Where(n => n.UserId == userId).OrderBy(n => n.Id).ToListAsync(ct);

    public Task<bool> ExistsAsync(int userId, CancellationToken ct) => db.Users.AnyAsync(u => u.Id == userId, ct);

    public Task<User?> FindAsync(int id, CancellationToken ct) =>
        db.Users.FirstOrDefaultAsync(u => u.Id == id, ct);

    public void AddUser(User user) => db.Users.Add(user);

    public void RemoveUser(User user) => db.Users.Remove(user);

    public void AddNote(UserNote note) => db.UserNotes.Add(note);

    // The unique username index catches two people taking the same name at the same moment, which the check
    // before it can miss. Any other save error is thrown so the caller answers it the same way as before.
    public async Task<bool> TrySaveAsync(CancellationToken ct)
    {
        try
        {
            await db.SaveChangesAsync(ct);
            return true;
        }
        catch (DbUpdateException)
        {
            db.ChangeTracker.Clear();
            return false;
        }
    }

    public Task SaveAsync(CancellationToken ct) => db.SaveChangesAsync(ct);

    public Task DeleteSessionsAsync(int userId, CancellationToken ct) =>
        db.Sessions.Where(s => s.UserId == userId).ExecuteDeleteAsync(ct);

    public Task<bool> AnyOtherEnabledAdminAsync(int userId, CancellationToken ct) =>
        db.Users.AnyAsync(u => u.Id != userId && u.Role == Roles.Admin && !u.Disabled, ct);

    public Task<int> DeleteNoteAsync(int noteId, int userId, CancellationToken ct) =>
        db.UserNotes.Where(n => n.Id == noteId && n.UserId == userId).ExecuteDeleteAsync(ct);
}
