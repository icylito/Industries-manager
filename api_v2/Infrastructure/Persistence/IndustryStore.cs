using api_v2.Application.Exceptions;
using api_v2.Application.Ports;
using api_v2.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace api_v2.Infrastructure.Persistence;

// The live Industries table, through EF. The unit of work is the AppDbContext this store is scoped with:
// the use case picks the order of the calls, and every save in one request goes through the same context.
public class IndustryStore(AppDbContext db) : IIndustryStore
{
    public async Task<IReadOnlyList<Industry>> AllAsync(CancellationToken ct) =>
        await db.Industries.AsNoTracking().OrderBy(i => i.Id).ToListAsync(ct);

    // The same comparison the unique name rule uses: lower(btrim(Name)) in Postgres, never C#.
    // position() keeps the needle a plain substring, so a % or _ in it can't act as a wildcard.
    public async Task<IReadOnlyList<Industry>> SearchAsync(string needle, int take, CancellationToken ct) =>
        await db.Industries.FromSql($"""
            SELECT * FROM "Industries"
            WHERE position(lower(btrim({needle})) in lower(btrim("Name"))) > 0
            ORDER BY lower(btrim("Name")), "Id"
            LIMIT {take}
            """).AsNoTracking().ToListAsync(ct);

    // Rows with no price are skipped. Highest first, ties by lower(btrim(Name)) then Id, the same comparison
    // the search endpoint and the unique name rule use.
    public async Task<IReadOnlyList<Industry>> TopByPriceAsync(int take, CancellationToken ct) =>
        await db.Industries.FromSql($"""
            SELECT * FROM "Industries"
            WHERE "Price" IS NOT NULL
            ORDER BY "Price" DESC, lower(btrim("Name")), "Id"
            LIMIT {take}
            """).AsNoTracking().ToListAsync(ct);

    public async Task<IReadOnlyList<Industry>> ByIdsAsync(IReadOnlyList<int> ids, CancellationToken ct) =>
        await db.Industries.AsNoTracking()
            .Where(i => ids.Contains(i.Id))
            .OrderBy(i => i.Id)
            .ToListAsync(ct);

    public async Task<Industry?> FindAsync(int id, CancellationToken ct) => await db.Industries.FindAsync([id], ct);

    public void Add(Industry row) => db.Industries.Add(row);

    public void Remove(Industry row) => db.Industries.Remove(row);

    // The unique index catches 2 saves of the same name at the same moment, which the check before it can miss.
    // Any other save error is thrown so the caller can mark the change failed.
    public async Task<bool> SaveAsync(CancellationToken ct)
    {
        try
        {
            await db.SaveChangesAsync(ct);
            return true;
        }
        catch (DbUpdateConcurrencyException)
        {
            db.ChangeTracker.Clear();
            throw new RowGoneException();
        }
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            db.ChangeTracker.Clear();
            return false;
        }
    }

    public async Task<IReadOnlyList<Industry>> FlaggedAgainstAsync(int ownerId, CancellationToken ct) =>
        await db.Industries.Where(r => r.DuplicateOf == ownerId).OrderBy(r => r.Id).ToListAsync(ct);

    // The row that owns the name right now, ignoring the given ids, or null when nobody does
    public async Task<int?> OwnerOfNameAsync(string name, IReadOnlyCollection<int> excluding, CancellationToken ct)
    {
        var ids = excluding.ToArray();
        var found = await db.Database.SqlQuery<int>($"""
            SELECT "Id" AS "Value" FROM "Industries"
            WHERE "DuplicateOf" IS NULL AND "Name" COLLATE name_rule = {name} AND "Id" <> ALL({ids})
            ORDER BY "Id" LIMIT 1
            """).ToListAsync(ct);
        return found.Count == 0 ? null : found[0];
    }
}
