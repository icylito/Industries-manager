using System.Text.Json;
using api_v2.Application.Ports;
using api_v2.Domain.Entities;
using api_v2.Domain.Rules;
using Microsoft.EntityFrameworkCore;

namespace api_v2.Infrastructure.Persistence;

// The RuleVersions table, through EF. Saving a version is one insert; deleting a custom field is one transaction
// that touches the industry rows, the requests waiting on the field, and the rules version.
public class RulesStore(AppDbContext db) : IRulesStore
{
    public Task<RuleVersion?> LatestAsync(CancellationToken ct) =>
        db.RuleVersions.OrderByDescending(r => r.Id).FirstOrDefaultAsync(ct);

    public async Task<IReadOnlyList<string>> FieldsJsonAsync(CancellationToken ct) =>
        await db.RuleVersions.AsNoTracking().Select(r => r.Fields).ToListAsync(ct);

    public async Task<IReadOnlyList<RuleVersion>> VersionsAsync(CancellationToken ct) =>
        await db.RuleVersions.AsNoTracking().OrderByDescending(r => r.Id).ToListAsync(ct);

    public async Task<RuleVersion> InsertVersionAsync(RuleVersion version, CancellationToken ct)
    {
        db.RuleVersions.Add(version);
        await db.SaveChangesAsync(ct);
        return version;
    }

    public async Task<(RuleSet Saved, int RowsChanged, int RequestsClosed)> DeleteFieldAsync(
        string key, string label, IReadOnlyList<FieldRule> kept, string changedBy, CancellationToken ct)
    {
        var strategy = db.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
            await using var tx = await db.Database.BeginTransactionAsync(ct);
            try
            {
                var rowsChanged = await db.Database.ExecuteSqlInterpolatedAsync($$"""
                    UPDATE "Industries"
                    SET "Extra" = NULLIF("Extra" - {{key}}, '{}'::jsonb)
                    WHERE jsonb_exists("Extra", {{key}})
                    """, ct);

                await db.Database.ExecuteSqlInterpolatedAsync($"""
                    UPDATE "Industries"
                    SET "LostFields" = CASE
                        WHEN cardinality(array_remove("LostFields", {key})) = 0 THEN NULL
                        ELSE array_remove("LostFields", {key})
                    END
                    WHERE {key} = ANY("LostFields")
                    """, ct);

                var open = await db.Requests
                    .Where(r => (r.Status == "open" || r.Status == "in-progress") && r.FieldKey == key)
                    .ToListAsync(ct);
                var now = DateTimeOffset.UtcNow;
                const string line = "The field was deleted, so this was closed by itself.";
                foreach (var request in open)
                {
                    request.Status = "dismissed";
                    request.ResolvedAt = now;
                    request.ResolvedBy = "system";
                    request.Details = string.IsNullOrWhiteSpace(request.Details) ? line : request.Details.TrimEnd() + "\n" + line;
                }

                var row = new RuleVersion
                {
                    CreatedAt = DateTimeOffset.UtcNow,
                    ChangedBy = changedBy,
                    Note = $"Deleted the field {label}",
                    Fields = JsonSerializer.Serialize(kept.Select(f => f with { Label = f.Label.Trim() }), RuleJson.Json)
                };
                db.RuleVersions.Add(row);
                await db.SaveChangesAsync(ct);
                await tx.CommitAsync(ct);
                return (RuleJson.ToRuleSet(row), rowsChanged, open.Count);
            }
            catch
            {
                try
                {
                    await tx.RollbackAsync(CancellationToken.None);
                }
                catch
                {
                    // The connection is gone, which rolls the transaction back anyway
                }
                db.ChangeTracker.Clear();
                throw;
            }
        });
    }
}
