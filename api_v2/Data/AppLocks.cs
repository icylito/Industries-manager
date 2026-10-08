using Npgsql;

namespace api_v2.Data;

// Advisory locks belong to the database session, so a crash frees them, and they work if the API runs twice.
public enum AppLock { Table = 1, Rules = 2, Requests = 3, Settings = 4, Scratchpad = 5 }

public class AppBusyException : Exception;

public class AppLocks(DatabaseConnections connections)
{
    public async Task<IAsyncDisposable> TakeAsync(AppLock which, CancellationToken ct = default)
    {
        var connection = new NpgsqlConnection(connections.Main);
        try
        {
            await connection.OpenAsync(ct);
            var key = (long)which;
            try
            {
                await using var command = new NpgsqlCommand("SELECT pg_advisory_lock(@key)", connection)
                {
                    CommandTimeout = 120
                };
                command.Parameters.AddWithValue("key", key);
                await command.ExecuteScalarAsync(ct);
            }
            catch (Exception ex) when (TimedOut(ex))
            {
                throw new AppBusyException();
            }

            return new SessionLock(connection, key);
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

    private sealed class SessionLock(NpgsqlConnection connection, long key) : IAsyncDisposable
    {
        public async ValueTask DisposeAsync()
        {
            try
            {
                await using var command = new NpgsqlCommand("SELECT pg_advisory_unlock(@key)", connection);
                command.Parameters.AddWithValue("key", key);
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
