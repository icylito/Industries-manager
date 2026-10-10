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
    // The steps of the state chain (what is always current). They never change the data's layout, so a backup or a
    // History version that recorded one in its list (made before the chains were split) still has the same layout.
    private HashSet<string> _stateSteps = [];
    public DateTimeOffset UpdatedAt { get; private set; } = DateTimeOffset.UtcNow;
    public bool HistoryReady { get; private set; }
    public string HistoryMessage { get; private set; } = "";
    // True once history was set up at least once. Before that, startup owns the history state, not the monitor.
    public bool HistoryWasReady { get; private set; }

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

    public void SetStateSteps(IEnumerable<string> steps)
    {
        lock (_lock)
        {
            _stateSteps = steps.ToHashSet();
        }
    }

    // A recorded list of migrations without the state chain's steps: the data layout it describes
    public IReadOnlyList<string> DataSteps(IEnumerable<string> recorded)
    {
        lock (_lock)
        {
            return recorded.Where(step => !_stateSteps.Contains(step)).ToList();
        }
    }

    // True when a backup or a History version was made with the data laid out as it is now
    public bool SameLayout(IEnumerable<string> recorded) => AppliedMigrations.ToHashSet().SetEquals(DataSteps(recorded));

    public void SetHistory(bool ready, string message)
    {
        lock (_lock)
        {
            HistoryReady = ready;
            if (ready) HistoryWasReady = true;
            HistoryMessage = message;
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
                updatedAt = UpdatedAt,
                history = new { ready = HistoryReady, message = HistoryMessage }
            };
        }
    }
}
