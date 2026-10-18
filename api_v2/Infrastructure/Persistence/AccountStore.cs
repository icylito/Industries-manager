using api_v2.Application.Ports;
using api_v2.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace api_v2.Infrastructure.Persistence;

// Accounts and sessions, through EF. The unit of work is the scoped AppDbContext.
public class AccountStore(AppDbContext db) : IAccounts
{
    public Task<User?> FindByUsernameAsync(string username, CancellationToken ct) =>
        db.Users.FirstOrDefaultAsync(u => u.Username == username, ct);

    public Task<User> FindAsync(int id, CancellationToken ct) =>
        db.Users.FirstAsync(u => u.Id == id, ct);

    public async Task AddSessionAsync(Session session, DateTimeOffset now, CancellationToken ct)
    {
        db.Sessions.Add(session);
        await db.SaveChangesAsync(ct);
        // Old sign ins that ran out are cleared out each time someone signs in
        await db.Sessions.Where(s => s.ExpiresAt < now).ExecuteDeleteAsync(ct);
    }

    public Task DeleteSessionAsync(long sessionId, CancellationToken ct) =>
        db.Sessions.Where(s => s.Id == sessionId).ExecuteDeleteAsync(ct);

    public Task DeleteOtherSessionsAsync(int userId, long? keepSessionId, CancellationToken ct) =>
        db.Sessions.Where(s => s.UserId == userId && s.Id != keepSessionId).ExecuteDeleteAsync(ct);

    public Task SaveAsync(CancellationToken ct) => db.SaveChangesAsync(ct);
}
