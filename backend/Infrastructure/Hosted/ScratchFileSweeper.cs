using api_v2.Application.Health;
using api_v2.Application.Jobs;
using api_v2.Infrastructure.Files;

namespace api_v2.Infrastructure.Hosted;

// Once the database is ready: copies in any Scratchpad file still in the old folder, then runs
// Application/Jobs/ScratchFileSweep hourly, each run in its own scope.
public sealed class ScratchFileSweeper(
    IServiceScopeFactory scopes,
    DatabaseStatus status,
    IConfiguration config,
    ILogger<ScratchFileSweeper> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        if (!await status.WaitUntilReadyAsync(ct)) return;

        try
        {
            using var scope = scopes.CreateScope();
            await scope.ServiceProvider.GetRequiredService<ScratchFileImport>().RunAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "Copying the old Scratchpad files into the database failed, it's tried again when the API next starts");
        }

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
