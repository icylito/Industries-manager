using api_v2.Application.Health;
using api_v2.Application.Hosted;
using api_v2.Application.Backups;

namespace api_v2.Application.Hosted;

// Nightly backups, plus a catch-up when this PC was off at backup time.
public sealed class BackupScheduler(BackupService backups, DatabaseStatus status, ILogger<BackupScheduler> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        // Doesn't need the database, so old backups get sealed as soon as the API starts
        try
        {
            await backups.SealExistingAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogError(ex, "Sealing old backups failed");
        }

        if (!await status.WaitUntilReadyAsync(ct)) return;

        while (!ct.IsCancellationRequested)
        {
            try
            {
                await CheckAsync(ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogError(ex, "Backup check failed");
            }

            try
            {
                await Task.Delay(TimeSpan.FromMinutes(5), ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                return;
            }
        }
    }

    private async Task CheckAsync(CancellationToken ct)
    {
        if (status.State != DatabaseState.Ready)
        {
            return;
        }

        var list = backups.List();
        var newest = list.Count == 0 ? null : list[0];
        var catchUp = newest is null || newest.CreatedAt < DateTimeOffset.UtcNow.AddHours(-24);
        var localNow = DateTimeOffset.Now;
        var nightlyDue = localNow.TimeOfDay >= backups.NightlyTime
            && !list.Any(entry => entry.Kind == "nightly" && entry.CreatedAt.ToLocalTime().Date == localNow.Date);
        if (!catchUp && !nightlyDue)
        {
            return;
        }

        try
        {
            await backups.RunAsync("nightly", "scheduled", ct);
        }
        catch (BackupBusyException)
        {
            // A manual backup is already running. The next check tries again.
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogError(ex, "Nightly backup failed");
        }
    }
}
