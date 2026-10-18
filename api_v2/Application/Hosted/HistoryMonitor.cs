using api_v2.Infrastructure.Persistence;
using api_v2.Application.Health;

namespace api_v2.Application.Hosted;

// Keeps /health honest about the history database after startup. MigrationService brings history up the first
// time. From then on this checks it every 30 seconds, marks it down when it stops answering and up again when it's back.
public sealed class HistoryMonitor(CollectorStore collector, DatabaseStatus status, ILogger<HistoryMonitor> log) : BackgroundService
{
    private static readonly TimeSpan Every = TimeSpan.FromSeconds(30);

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(Every, ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                return;
            }

            // Until history was up once, startup owns its state (it may still be saving a copy before a migration)
            if (status.State != DatabaseState.Ready || !status.HistoryWasReady) continue;

            var up = await collector.PingAsync(ct);
            if (up && !status.HistoryReady)
            {
                status.SetHistory(true, "History is ready");
                log.LogInformation("The history database is reachable again");
            }
            else if (!up && status.HistoryReady)
            {
                status.SetHistory(false, CollectorStore.UnreachableMessage);
                log.LogWarning("The history database stopped answering, History is offline until it's back");
            }
        }
    }
}
