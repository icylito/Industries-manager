using api_v2.Application.Health;
using api_v2.Application.Ports;
using api_v2.Domain.Tables;

namespace api_v2.Application.Hosted;

// Once the database is ready: writes the readable copies of every table (UserTableMirror), then every hour
// deletes for good the tables that have sat in the bin for 14 days, with their rows and their copy.
public sealed class TableBinSweeper(
    IServiceScopeFactory scopes,
    DatabaseStatus status,
    IUserTableMirror mirror,
    ILogger<TableBinSweeper> log) : BackgroundService
{
    private static readonly TimeSpan Every = TimeSpan.FromHours(1);

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        if (!await status.WaitUntilReadyAsync(ct)) return;

        try
        {
            await mirror.RebuildAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "Couldn't write the readable copies of the tables, they are written as tables change");
        }

        using var timer = new PeriodicTimer(Every);
        do
        {
            try
            {
                await SweepAsync(ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogWarning(ex, "Emptying the table bin failed, it's tried again in an hour");
            }
        } while (await timer.WaitForNextTickAsync(ct));
    }

    public async Task SweepAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var store = scope.ServiceProvider.GetRequiredService<IUserTablesStore>();
        var cutoff = DateTimeOffset.UtcNow - TableLimits.BinKeeps;
        foreach (var table in await store.DeleteExpiredAsync(cutoff, ct))
        {
            await mirror.RemovedAsync(table.Id, ct);
            log.LogInformation("Table {Name} ({Id}) was in the bin for 14 days and is now deleted for good", table.Name, table.Id);
        }
    }
}