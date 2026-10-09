using api_v2.Data;
using Microsoft.EntityFrameworkCore;

namespace api_v2.Tables;

// Once the database is ready: writes the readable copies of every table (UserTableMirror), then every hour
// deletes for good the tables that have sat in the bin for 14 days, with their rows and their copy.
public sealed class TableBinSweeper(
    IServiceScopeFactory scopes,
    DatabaseStatus status,
    UserTableMirror mirror,
    ILogger<TableBinSweeper> log) : BackgroundService
{
    private static readonly TimeSpan Every = TimeSpan.FromHours(1);

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        while (status.State != DatabaseState.Ready)
        {
            if (status.State == DatabaseState.Failed) return;
            await Task.Delay(TimeSpan.FromSeconds(2), ct);
        }

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
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var cutoff = DateTimeOffset.UtcNow - TableLimits.BinKeeps;
        var expired = await db.UserTables.Where(t => t.DeletedAt != null && t.DeletedAt < cutoff)
            .Select(t => new { t.Id, t.Name }).ToListAsync(ct);
        foreach (var table in expired)
        {
            // The rows go with it (cascade)
            await db.UserTables.Where(t => t.Id == table.Id && t.DeletedAt != null && t.DeletedAt < cutoff).ExecuteDeleteAsync(ct);
            await mirror.RemovedAsync(table.Id, ct);
            log.LogInformation("Table {Name} ({Id}) was in the bin for 14 days and is now deleted for good", table.Name, table.Id);
        }
    }
}
