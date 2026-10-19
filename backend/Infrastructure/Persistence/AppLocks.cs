using Npgsql;
using api_v2.Application.Exceptions;
using api_v2.Application.Ports;
using api_v2.Infrastructure.Configuration;

namespace api_v2.Infrastructure.Persistence;

public class AppLocks(DatabaseConnections connections) : IAppLocks
{
    // One lock for everyone: changes to the table, the rules, the requests and the settings take turns
    public Task<IAsyncDisposable> TakeAsync(AppLock which, CancellationToken ct = default) =>
        TakeAsync("SELECT pg_advisory_lock(@key)", "SELECT pg_advisory_unlock(@key)", [("key", (long)which)], ct);

    // One lock per person within one area, so one person's saves take turns without making anyone else wait.
    // The two number form of the lock is its own set of keys, so it never meets the single number locks above.
    public Task<IAsyncDisposable> TakeAsync(AppLock which, int person, CancellationToken ct = default) =>
        TakeAsync("SELECT pg_advisory_lock(@area, @person)", "SELECT pg_advisory_unlock(@area, @person)",
            [("area", (int)which), ("person", person)], ct);

    private async Task<IAsyncDisposable> TakeAsync(string lockSql, string unlockSql, (string Name, object Value)[] keys, CancellationToken ct)
    {
        var connection = new NpgsqlConnection(connections.Main);
        try
        {
            await connection.OpenAsync(ct);
            try
            {
                await using var command = new NpgsqlCommand(lockSql, connection)
                {
                    CommandTimeout = 120
                };
                foreach (var (name, value) in keys) command.Parameters.AddWithValue(name, value);
                await command.ExecuteScalarAsync(ct);
            }
            catch (Exception ex) when (TimedOut(ex))
            {
                throw new AppBusyException();
            }

            return new SessionLock(connection, unlockSql, keys);
        }
        catch
        {
            await DisposeQuiet(connection);
            throw;
        }
    }

    // Npgsql reports a command timeout as TimeoutException inside NpgsqlException.
    // Postgres 57014 is the same wait being cancelled on the server.
    private static bool TimedOut(Exception ex)
    {
        for (var current = ex; current is not null; current = current.InnerException)
        {
            if (current is TimeoutException) return true;
            if (current is PostgresException { SqlState: PostgresErrorCodes.QueryCanceled }) return true;
        }
        return false;
    }

    private static async Task DisposeQuiet(NpgsqlConnection connection)
    {
        try
        {
            await connection.DisposeAsync();
        }
        catch
        {
            // The session is already closed, so the lock is already gone
        }
    }

    private sealed class SessionLock(NpgsqlConnection connection, string unlockSql, (string Name, object Value)[] keys) : IAsyncDisposable
    {
        public async ValueTask DisposeAsync()
        {
            try
            {
                await using var command = new NpgsqlCommand(unlockSql, connection);
                foreach (var (name, value) in keys) command.Parameters.AddWithValue(name, value);
                await command.ExecuteScalarAsync();
            }
            catch
            {
                // The closed session frees the lock anyway
            }

            await DisposeQuiet(connection);
        }
    }
}
