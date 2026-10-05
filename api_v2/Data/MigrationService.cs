using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace api_v2.Data;

// Applies any pending migrations when the API starts. Runs in the background so
// the API is already listening and /health can report progress or failure.
public class MigrationService(
    IServiceScopeFactory scopes,
    DatabaseStatus status,
    ILogger<MigrationService> log) : BackgroundService
{
    private const int MaxAttempts = 5;

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        for (var attempt = 1; attempt <= MaxAttempts; attempt++)
        {
            try
            {
                using var scope = scopes.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

                var pending = (await db.Database.GetPendingMigrationsAsync(ct)).ToList();
                status.Set(DatabaseState.Migrating,
                    pending.Count == 0 ? "Checking the database" : $"Applying {pending.Count} migration(s)", attempt);

                await db.Database.MigrateAsync(ct);

                var applied = (await db.Database.GetAppliedMigrationsAsync(ct)).ToList();
                var message = pending.Count == 0
                    ? "Database is up to date"
                    : $"Applied {string.Join(", ", pending)}";
                status.Set(DatabaseState.Ready, message, attempt, applied);
                log.LogInformation("Database ready after {Attempts} attempt(s): {Message}", attempt, message);
                return;
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex) when (IsTransient(ex) && attempt < MaxAttempts)
            {
                // 2s, 4s, 8s, 16s
                var delay = TimeSpan.FromSeconds(Math.Pow(2, attempt));
                status.Set(DatabaseState.Migrating,
                    $"Database not reachable, retry {attempt} of {MaxAttempts - 1} in {delay.TotalSeconds:0}s", attempt);
                log.LogWarning(ex, "Migration attempt {Attempt} failed, retrying in {Delay}", attempt, delay);
                await Task.Delay(delay, ct);
            }
            catch (Exception ex)
            {
                status.Set(DatabaseState.Failed, $"Migration failed: {ex.GetBaseException().Message}", attempt);
                log.LogError(ex, "Migration failed on attempt {Attempt}, not retrying", attempt);
                return;
            }
        }
    }

    // Network drops and timeouts are worth retrying. A wrong password or a broken
    // migration fails the same way every time, so those stop right away.
    private static bool IsTransient(Exception ex) => ex switch
    {
        NpgsqlException npg when npg.IsTransient => true,
        TimeoutException or System.Net.Sockets.SocketException => true,
        _ when ex.InnerException is not null => IsTransient(ex.InnerException),
        _ => false
    };
}
