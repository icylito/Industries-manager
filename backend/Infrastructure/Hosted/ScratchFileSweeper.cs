using api_v2.Application.Health;
using api_v2.Application.Jobs;

namespace api_v2.Infrastructure.Hosted;

// Runs Application/Jobs/ScratchFileSweep hourly once the database is ready, each run in its own scope.
public sealed class ScratchFileSweeper(
    IServiceScopeFactory scopes,
    DatabaseStatus status,
    IConfiguration config,
    ILogger<ScratchFileSweeper> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        if (!await status.WaitUntilReadyAsync(ct)) return;

        // Hourly. A throwaway API can set Scratchpad:SweepMinutes lower.
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(Math.Max(1, config.GetValue("Scratchpad:SweepMinutes", 60))));
        do
        {
            try
            {
                using var scope = scopes.CreateScope();
                await scope.ServiceProvider.GetRequiredService<ScratchFileSweep>().RunAsync(DateTimeOffset.UtcNow, ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogWarning(ex, "Tidying the Scratchpad files failed, it's tried again later");
            }
        } while (await timer.WaitForNextTickAsync(ct));
    }
}
