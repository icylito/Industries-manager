using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using api_v2.Domain.Rules;
using Npgsql;
using api_v2.Application.Health;
using api_v2.Infrastructure.Configuration;
using api_v2.Infrastructure.Persistence;
using api_v2.Application.Settings;
using api_v2.Application.Ports;

namespace api_v2.Application.Startup;

// Applies any pending migrations when the API starts. Runs in the background so
// the API is already listening and /health can report progress or failure.
// Two chains: the data's (DataMigrationsContext), which a copy in History guards, then what is always current
// (StateMigrationsContext), which changes no data, so it needs no copy. See Data/MigrationContexts.cs.
public class MigrationService(
    IServiceScopeFactory scopes,
    DatabaseStatus status,
    DatabaseConnections connections,
    CollectorStore collector,
    RulesService rules,
    SettingsService settings,
    AppLocks locks,
    IConfiguration config,
    ILogger<MigrationService> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        if (connections.UsingDockerDefault)
        {
            log.LogInformation("No connection string set, using the Docker database from docker-compose.yml on port 5433");
        }

        // Main comes up on its own. History is set up afterwards, unless an existing
        // database has a pending change, which still needs a copy saved first.
        for (var attempt = 1; !ct.IsCancellationRequested; attempt++)
        {
            var step = "main";
            try
            {
                var collectorReady = false;
                using (var scope = scopes.CreateScope())
                {
                    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                    var data = scope.ServiceProvider.GetRequiredService<DataMigrationsContext>();
                    var state = scope.ServiceProvider.GetRequiredService<StateMigrationsContext>();

                    status.Set(DatabaseState.Migrating, "Checking the database", attempt);
                    // Before its first run the state chain has no history table, and EF reading a missing one logs a
                    // failed query in the API window. Making the empty table first keeps the window clean.
                    await state.GetService<IHistoryRepository>().CreateIfNotExistsAsync(ct);
                    var stateSteps = state.Database.GetMigrations().ToList();
                    status.SetStateSteps(stateSteps);
                    // EF's own check can say the table is there on a brand new database, so the table is looked up directly
                    if (await TableExistsAsync(state, ct)) await HandOverAsync(state, stateSteps, ct);
                    var pending = (await data.Database.GetPendingMigrationsAsync(ct)).ToList();
                    var appliedBefore = (await data.Database.GetAppliedMigrationsAsync(ct)).ToList();

                    if (pending.Count > 0 && appliedBefore.Count > 0)
                    {
                        step = "collector";
                        status.Set(DatabaseState.Migrating, "Checking the collector database", attempt);
                        await EnsureDatabaseAsync(connections.Collector, ct);
                        await collector.EnsureSchemaAsync(ct);

                        // An existing database gets a full copy in the collector before its structure changes
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

                        collectorReady = true;
                        status.SetHistory(true, "History is ready");
                        step = "main";
                    }

                    status.Set(DatabaseState.Migrating,
                        pending.Count == 0 ? "Checking the database" : $"Applying {pending.Count} migration(s)", attempt);

                    await data.Database.MigrateAsync(ct);
                    var statePending = (await state.Database.GetPendingMigrationsAsync(ct)).ToList();
                    await state.Database.MigrateAsync(ct);
                    await rules.LoadAsync(db, ct);
                    // The sector list is saved with a table copy, so it needs history. When history isn't set up yet
                    // it waits for BringHistoryUpAsync, so a slow history database never holds the main one back.
                    if (collectorReady)
                    {
                        await rules.SyncSectorsAsync(db, ct);
                    }
                    await settings.LoadAsync(db, ct);
                    // Someone must always be able to sign in, see UserService.EnsureAdminAsync
                    await Auth.UserService.EnsureAdminAsync(db, config, log, ct);

                    // The data chain's list is the layout backups and History versions are compared by
                    var applied = (await data.Database.GetAppliedMigrationsAsync(ct)).ToList();
                    var all = pending.Concat(statePending).ToList();
                    var message = all.Count == 0
                        ? "Database is up to date"
                        : $"Applied {string.Join(", ", all)}";
                    if (!collectorReady)
                    {
                        status.SetHistory(false, "Checking the history database");
                    }
                    status.Set(DatabaseState.Ready, message, attempt, applied);
                    log.LogInformation("Database ready after {Attempts} attempt(s): {Message}", attempt, message);
                }

                if (!collectorReady)
                {
                    await BringHistoryUpAsync(ct);
                }
                return;
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex) when (IsTransient(ex))
            {
                // 2s, 4s, 8s, 16s, then every 30s until the database answers or the app stops
                var seconds = attempt <= 4 ? Math.Pow(2, attempt) : 30;
                var delay = TimeSpan.FromSeconds(seconds);
                var where = step == "collector" ? "The history database (collector)" : "The main database";
                status.Set(DatabaseState.Migrating, $"{where} isn't reachable, retrying in {delay.TotalSeconds:0}s", attempt);
                log.LogWarning(ex, "Migration attempt {Attempt} failed on {Step}, retrying in {Delay}", attempt, step, delay);
                try
                {
                    await Task.Delay(delay, ct);
                }
                catch (OperationCanceledException) when (ct.IsCancellationRequested)
                {
                    return;
                }
            }
            catch (Exception ex)
            {
                status.Set(DatabaseState.Failed, $"Migration failed: {ex.GetBaseException().Message}", attempt);
                log.LogError(ex, "Migration failed on attempt {Attempt}, not retrying", attempt);
                return;
            }
        }
    }

    // Whether the data chain's history table is there at all. A brand new database has none until the data chain runs.
    private static async Task<bool> TableExistsAsync(StateMigrationsContext state, CancellationToken ct)
    {
        return await state.Database.SqlQuery<bool>($"""SELECT to_regclass('public."__EFMigrationsHistory"') IS NOT NULL AS "Value" """).SingleAsync(ct);
    }

    // A database that ran a step before the chains were split has it in the data chain's history. Those steps belong to
    // the state chain now, so their record moves there, in one go, and they are never run a second time.
    private async Task HandOverAsync(StateMigrationsContext state, List<string> stateSteps, CancellationToken ct)
    {
        var steps = stateSteps.ToArray();
        await using var tx = await state.Database.BeginTransactionAsync(ct);
        var moved = await state.Database.ExecuteSqlAsync($$"""
            INSERT INTO "__StateMigrationsHistory" ("MigrationId", "ProductVersion")
            SELECT "MigrationId", "ProductVersion" FROM "__EFMigrationsHistory" WHERE "MigrationId" = ANY({{steps}})
            ON CONFLICT ("MigrationId") DO NOTHING
            """, ct);
        await state.Database.ExecuteSqlAsync($"""DELETE FROM "__EFMigrationsHistory" WHERE "MigrationId" = ANY({steps})""", ct);
        await tx.CommitAsync(ct);
        if (moved > 0) log.LogInformation("Moved {Count} step(s) the data chain had run before the split to the state chain", moved);
    }

    // History keeps retrying after the main database is already usable.
    private async Task BringHistoryUpAsync(CancellationToken ct)
    {
        for (var attempt = 1; !ct.IsCancellationRequested; attempt++)
        {
            try
            {
                await EnsureDatabaseAsync(connections.Collector, ct);
                await collector.EnsureSchemaAsync(ct);
                status.SetHistory(true, "History is ready");
                log.LogInformation("History database ready after {Attempts} attempt(s)", attempt);

                // The page is already serving, so take the same rules lock the Fields page uses.
                // A failure here is logged only, history itself is fine.
                try
                {
                    await using var rulesLock = await locks.TakeAsync(AppLock.Rules, ct);
                    using var scope = scopes.CreateScope();
                    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                    await rules.LoadAsync(db, ct);
                    await rules.SyncSectorsAsync(db, ct);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    log.LogWarning(ex, "The sector list from config.toml wasn't applied, it's tried again on the next start");
                }
                return;
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex) when (IsTransient(ex))
            {
                var seconds = attempt <= 4 ? Math.Pow(2, attempt) : 30;
                var delay = TimeSpan.FromSeconds(seconds);
                status.SetHistory(false, $"The history database (collector) isn't reachable, retrying in {delay.TotalSeconds:0}s");
                log.LogWarning(ex, "History setup attempt {Attempt} failed, retrying in {Delay}", attempt, delay);
                try
                {
                    await Task.Delay(delay, ct);
                }
                catch (OperationCanceledException) when (ct.IsCancellationRequested)
                {
                    return;
                }
            }
            catch (Exception ex)
            {
                status.SetHistory(false, $"The history database (collector) couldn't be set up: {ex.GetBaseException().Message}");
                log.LogError(ex, "History setup failed, not retrying");
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
