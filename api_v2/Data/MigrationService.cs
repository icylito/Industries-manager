using Microsoft.EntityFrameworkCore;
using api_v2.Rules;
using Npgsql;

namespace api_v2.Data;

// Applies any pending migrations when the API starts. Runs in the background so
// the API is already listening and /health can report progress or failure.
public class MigrationService(
    IServiceScopeFactory scopes,
    DatabaseStatus status,
    DatabaseConnections connections,
    CollectorStore collector,
    RulesService rules,
    ILogger<MigrationService> log) : BackgroundService
{
    private const int MaxAttempts = 5;

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        if (connections.UsingDockerDefault)
        {
            log.LogInformation("No connection string set, using the Docker database from docker-compose.yml on port 5433");
        }

        for (var attempt = 1; attempt <= MaxAttempts; attempt++)
        {
            try
            {
                status.Set(DatabaseState.Migrating, "Checking the collector database", attempt);
                await EnsureDatabaseAsync(connections.Collector, ct);
                await collector.EnsureSchemaAsync(ct);

                using var scope = scopes.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

                var pending = (await db.Database.GetPendingMigrationsAsync(ct)).ToList();

                // An existing database gets a full copy in the collector before its structure changes
                if (pending.Count > 0 && (await db.Database.GetAppliedMigrationsAsync(ct)).Any())
                {
                    status.Set(DatabaseState.Migrating, "Saving a copy before updating the database", attempt);
                    try
                    {
                        await collector.SaveVersionAsync($"Before database update {string.Join(", ", pending)}", "system", ct);
                    }
                    catch (Exception ex) when (!IsTransient(ex) && ex is not OperationCanceledException)
                    {
                        status.Set(DatabaseState.Failed,
                            $"Couldn't save a copy before updating the database, so nothing was changed: {ex.GetBaseException().Message}", attempt);
                        log.LogError(ex, "Copy before migration failed, not migrating");
                        return;
                    }
                }

                status.Set(DatabaseState.Migrating,
                    pending.Count == 0 ? "Checking the database" : $"Applying {pending.Count} migration(s)", attempt);

                await db.Database.MigrateAsync(ct);
                await rules.LoadAsync(db, ct);

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

    // EF creates the main database by itself, the collector one gets created here
    private async Task EnsureDatabaseAsync(string connectionString, CancellationToken ct)
    {
        var target = new NpgsqlConnectionStringBuilder(connectionString);
        var name = target.Database!;
        var server = new NpgsqlConnectionStringBuilder(connectionString) { Database = "postgres" };

        await using var conn = new NpgsqlConnection(server.ConnectionString);
        await conn.OpenAsync(ct);

        await using var exists = new NpgsqlCommand("SELECT 1 FROM pg_database WHERE datname = @name", conn);
        exists.Parameters.AddWithValue("name", name);
        if (await exists.ExecuteScalarAsync(ct) is not null)
        {
            return;
        }

        try
        {
            await using var create = new NpgsqlCommand($"CREATE DATABASE \"{name.Replace("\"", "\"\"")}\"", conn);
            await create.ExecuteNonQueryAsync(ct);
            log.LogInformation("Created the {Database} database", name);
        }
        catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.DuplicateDatabase)
        {
            // Another API instance made it at the same moment, that's fine
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
