using api_v2.Domain.Accounts;
using api_v2.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using api_v2.Application.Ports;

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

    public void AddUser(User user) => db.Users.Add(user);

    // True when another account has the same username by the one name rule: "ali.k" and "ali_k"
    public async Task<bool> UsernameTakenAsync(string username, int? exceptId, CancellationToken ct) =>
        await db.Database.SqlQuery<int>($"""
            SELECT count(*)::int AS "Value" FROM "Users" WHERE "Username" COLLATE name_rule = {username} AND "Id" <> {exceptId ?? 0}
            """).SingleAsync(ct) > 0;

    public Task RefreshNameClashesAsync(CancellationToken ct) =>
        db.Database.ExecuteSqlRawAsync("""
            UPDATE "Users" AS u SET "NameClash" = EXISTS (
                SELECT 1 FROM "Users" AS o WHERE o."Id" < u."Id" AND o."Username" COLLATE name_rule = u."Username")
            WHERE u."NameClash"
            """, ct);

    public Task<bool> AnyEnabledAdminAsync(CancellationToken ct) =>
        db.Users.AnyAsync(u => u.Role == Roles.Admin && !u.Disabled, ct);

    public Task DeleteSessionsForUserAsync(int userId, CancellationToken ct) =>
        db.Sessions.Where(s => s.UserId == userId).ExecuteDeleteAsync(ct);

    public Task SaveAsync(CancellationToken ct) => db.SaveChangesAsync(ct);
}
