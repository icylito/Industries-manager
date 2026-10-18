using api_v2.Application.Ports;
using api_v2.Domain.Rules;

namespace api_v2.Infrastructure.Persistence;

// Whether a name is already in the table, by the one name rule the unique index uses
public class NameIndex(AppDbContext db) : INameIndex
{
    public Task<bool> TakenAsync(string name, int? exceptId, CancellationToken ct = default) =>
        Names.TakenAsync(db, name, exceptId, ct);
}
