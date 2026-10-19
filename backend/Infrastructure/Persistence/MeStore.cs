using api_v2.Application.Ports;
using api_v2.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace api_v2.Infrastructure.Persistence;

// The signed in person's settings row, through EF
public class MeStore(AppDbContext db) : IMeStore
{
    public Task<UserSettings?> FindAsync(int userId, CancellationToken ct) =>
        db.UserSettings.FirstOrDefaultAsync(s => s.UserId == userId, ct);

    public void Add(UserSettings settings) => db.UserSettings.Add(settings);

    public async Task<bool> SaveAsync(CancellationToken ct)
    {
        try
        {
            await db.SaveChangesAsync(ct);
            return true;
        }
        catch (DbUpdateException)
        {
            // Two tabs saving a first time together: the other one made the row, so this one is one save late.
            db.ChangeTracker.Clear();
            return false;
        }
    }
}
