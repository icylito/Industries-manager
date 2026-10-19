using api_v2.Application.Ports;
using api_v2.Domain.Tables;

namespace api_v2.Application.Jobs;

// Writes the readable copies of every table (the mirror), and deletes for good the tables that have sat in the bin
// for 14 days, with their rows and their copy. Infrastructure/Hosted/TableBinSweeper runs it once the database is
// ready and then every hour.
public sealed class TableBinSweep(IUserTablesStore store, IUserTableMirror mirror, ILogger<TableBinSweep> log)
{
    public Task RebuildCopiesAsync(CancellationToken ct) => mirror.RebuildAsync(ct);

    public async Task RunAsync(DateTimeOffset now, CancellationToken ct)
    {
        var cutoff = now - TableLimits.BinKeeps;
        foreach (var table in await store.DeleteExpiredAsync(cutoff, ct))
        {
            await mirror.RemovedAsync(table.Id, ct);
            log.LogInformation("Table {Name} ({Id}) was in the bin for 14 days and is now deleted for good", table.Name, table.Id);
        }
    }
}
