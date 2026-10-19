using api_v2.Application.Jobs;

namespace api_v2.Infrastructure.Hosted;

// Runs Application/Jobs/HistoryCheck every 30 seconds for as long as the API is up
public sealed class HistoryMonitor(HistoryCheck check) : BackgroundService
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

            await check.RunAsync(ct);
        }
    }
}
