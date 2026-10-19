using api_v2.Application.Health;
using api_v2.Application.Ports;
using api_v2.Application.Requests;
using api_v2.Application.Rules;
using api_v2.Domain.Rules;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;

namespace api_v2.Infrastructure.Persistence;

// The one-step restore: the rows, the rules version they were saved under and the developer request that says the
// old layout differs all go in one transaction, so a failure leaves the table exactly as it was. The caller already
// holds the table and rules locks. The execution strategy is the DbContext's own, so a dropped connection is retried
// the same way every other write is.
public class HistoryRestoreRunner(AppDbContext db, TableWriter writer, RulesService rules, RulesAdminService admin,
    RequestService requestService, DatabaseStatus status) : IHistoryRestoreRunner
{
    public Task<HistoryRestoreRun> RunAsync(VersionDetail version, ImportPlan plan, long versionId, string by, CancellationToken ct)
    {
        var strategy = db.Database.CreateExecutionStrategy();
        return strategy.ExecuteAsync<HistoryRestoreRun>(async () =>
        {
            await using var tx = await db.Database.BeginTransactionAsync(ct);
            try
            {
                var rowsBefore = await db.Industries.CountAsync(ct);
                var restored = await writer.RestoreAsync(plan, (NpgsqlConnection)db.Database.GetDbConnection(),
                    (NpgsqlTransaction)tx.GetDbTransaction(), ct);

                var rulesRestored = false;
                if (version.Rules is not null && rules.Differs(version.Rules))
                {
                    await admin.SaveAsync(RulesService.ParseFields(version.Rules), $"Restored from version {versionId}", by, ct, copyFirst: false);
                    rulesRestored = true;
                }

                int? requestId = null;
                var current = status.AppliedMigrations.ToList();
                var then = status.DataSteps(version.Summary.Migrations);
                if (!status.SameLayout(version.Summary.Migrations))
                {
                    var request = await requestService.CreateAsync("restore-layout",
                        $"Bring back the table layout of version #{versionId}",
                        $"Version #{versionId} was restored, but the table looked different back then. Its rows were fitted into today's layout. A developer is needed to bring the old layout back.",
                        Drafts.RestoreLayout(versionId, then.Except(current), current.Except(then)),
                        by, ct: ct);
                    requestId = request.Request.Id;
                }

                await tx.CommitAsync(ct);
                return new HistoryRestoreRun.Done(restored, rulesRestored, requestId, rowsBefore);
            }
            catch (Exception ex) when (ex is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
            {
                await RecoverAsync(tx);
                return new HistoryRestoreRun.NameClash();
            }
            catch
            {
                await RecoverAsync(tx);
                throw;
            }
        });
    }

    // A failed transaction is rolled back, and the rules in memory are loaded again so they match the database.
    // The tracker is cleared first, because the rows it held belong to the transaction that is gone.
    private async Task RecoverAsync(IDbContextTransaction tx)
    {
        try
        {
            await tx.RollbackAsync(CancellationToken.None);
        }
        catch
        {
            // The connection is gone, so the transaction is already rolled back
        }
        db.ChangeTracker.Clear();
        try
        {
            await admin.LoadAsync(CancellationToken.None);
        }
        catch
        {
            // The next save loads them again
        }
    }
}
