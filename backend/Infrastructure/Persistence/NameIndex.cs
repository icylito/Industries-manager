using api_v2.Application.Ports;
using Microsoft.EntityFrameworkCore;

namespace api_v2.Infrastructure.Persistence;

// Whether a name is already in the table, by the one name rule the unique index uses.
// Rows flagged as copies (DuplicateOf set) don't count, same as the unique index.
public class NameIndex(AppDbContext db) : INameIndex
{
    public async Task<bool> TakenAsync(string name, int? exceptId, CancellationToken ct = default) =>
        await db.Database.SqlQuery<int>($"""
            SELECT count(*)::int AS "Value" FROM "Industries"
            WHERE "DuplicateOf" IS NULL AND "Name" COLLATE name_rule = {name} AND "Id" <> {exceptId ?? 0}
            """).SingleAsync(ct) > 0;
}