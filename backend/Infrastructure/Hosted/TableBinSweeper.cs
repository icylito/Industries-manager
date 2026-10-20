using api_v2.Application.Health;
using api_v2.Application.Jobs;

namespace api_v2.Infrastructure.Hosted;

// Once the database is ready, every hour empties the bin.
// The work itself is Application/Jobs/TableBinSweep, each run in its own scope.
public sealed class TableBinSweeper(IServiceScopeFactory scopes, DatabaseStatus status, ILogger<TableBinSweeper> log) : BackgroundService
{
    private static readonly TimeSpan Every = TimeSpan.FromHours(1);

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        if (!await status.WaitUntilReadyAsync(ct)) return;

        using var timer = new PeriodicTimer(Every);
        do
        {
            try
            {
                using var scope = scopes.CreateScope();
                await scope.ServiceProvider.GetRequiredService<TableBinSweep>().RunAsync(DateTimeOffset.UtcNow, ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogWarning(ex, "Emptying the table bin failed, it's tried again in an hour");
            }
        } while (await timer.WaitForNextTickAsync(ct));
    }
}
