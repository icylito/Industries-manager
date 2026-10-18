using api_v2.Application.Ports;
using Microsoft.EntityFrameworkCore;

namespace api_v2.Infrastructure.Persistence;

// The tables from the Tables page, through EF. Deleting a table takes its rows with it (cascade).
public class UserTablesStore(AppDbContext db) : IUserTablesStore
{
    public async Task<IReadOnlyList<UserTableExpired>> DeleteExpiredAsync(DateTimeOffset cutoff, CancellationToken ct)
    {
        var expired = await db.UserTables
            .Where(t => t.DeletedAt != null && t.DeletedAt < cutoff)
            .Select(t => new UserTableExpired(t.Id, t.Name))
            .ToListAsync(ct);
        foreach (var table in expired)
        {
            await db.UserTables
                .Where(t => t.Id == table.Id && t.DeletedAt != null && t.DeletedAt < cutoff)
                .ExecuteDeleteAsync(ct);
        }
        return expired;
    }
}
