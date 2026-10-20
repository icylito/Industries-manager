using api_v2.Application.Ports;
using api_v2.Domain.Tables;

namespace api_v2.Application.Jobs;

// Deletes for good the tables that have sat in the bin for 14 days, with their rows.
// Infrastructure/Hosted/TableBinSweeper runs it once the database is ready and then every hour.
public sealed class TableBinSweep(IUserTablesStore store, ILogger<TableBinSweep> log)
{
    public async Task RunAsync(DateTimeOffset now, CancellationToken ct)
    {
        var cutoff = now - TableLimits.BinKeeps;
        foreach (var table in await store.DeleteExpiredAsync(cutoff, ct))
        {
            log.LogInformation("Table {Name} ({Id}) was in the bin for 14 days and is now deleted for good", table.Name, table.Id);
        }
    }
}
