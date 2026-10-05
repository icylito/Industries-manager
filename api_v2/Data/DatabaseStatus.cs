namespace api_v2.Data;

public enum DatabaseState { Starting, Migrating, Ready, Failed }

// Shared between MigrationService (writes) and the /health endpoint and the
// industries endpoints (read), so it locks around every change
public class DatabaseStatus
{
    private readonly object _lock = new();

    public DatabaseState State { get; private set; } = DatabaseState.Starting;
    public string Message { get; private set; } = "Waiting to connect to the database";
    public int Attempts { get; private set; }
    public IReadOnlyList<string> AppliedMigrations { get; private set; } = [];
    public DateTimeOffset UpdatedAt { get; private set; } = DateTimeOffset.UtcNow;

    public void Set(DatabaseState state, string message, int attempts, IReadOnlyList<string>? applied = null)
    {
        lock (_lock)
        {
            State = state;
            Message = message;
            Attempts = attempts;
            if (applied is not null) AppliedMigrations = applied;
            UpdatedAt = DateTimeOffset.UtcNow;
        }
    }

    public object Snapshot()
    {
        lock (_lock)
        {
            return new
            {
                state = State.ToString().ToLowerInvariant(),
                message = Message,
                attempts = Attempts,
                appliedMigrations = AppliedMigrations,
                updatedAt = UpdatedAt
            };
        }
    }
}
