using api_v2.Application.Health;
using api_v2.Application.Ports;

namespace api_v2.Application.Jobs;

// Keeps /health honest about the history database after startup. MigrationService brings history up the first
// time. From then on Infrastructure/Hosted/HistoryMonitor runs this every 30 seconds: it marks history down when it
// stops answering and up again when it's back.
public sealed class HistoryCheck(ICollectorStore collector, DatabaseStatus status, ILogger<HistoryCheck> log)
{
    public async Task RunAsync(CancellationToken ct)
    {
        // Until history was up once, startup owns its state (it may still be saving a copy before a migration)
        if (status.State != DatabaseState.Ready || !status.HistoryWasReady) return;

        var up = await collector.PingAsync(ct);
        if (up && !status.HistoryReady)
        {
            status.SetHistory(true, "History is ready");
            log.LogInformation("The history database is reachable again");
        }
        else if (!up && status.HistoryReady)
        {
            status.SetHistory(false, ICollectorStore.UnreachableMessage);
            log.LogWarning("The history database stopped answering, History is offline until it's back");
        }
    }
}
