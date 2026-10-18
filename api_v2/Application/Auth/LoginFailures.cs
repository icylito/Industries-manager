using System.Collections.Concurrent;

namespace api_v2.Application.Auth;

// Wrong passwords per username, on top of the per-address limit in Program.cs. Someone guessing one account's
// password from many addresses still gets stopped. Only failures count, so a right password never locks anyone out,
// and a right password clears the count. Auth:FailedTriesPerName (default 10) in Auth:FailedTriesWindowMinutes (default 15).
// The cost: a stranger guessing can keep the real owner waiting until the window passes.
public sealed class LoginFailures(IConfiguration config)
{
    private readonly int limit = Math.Max(1, config.GetValue("Auth:FailedTriesPerName", 10));
    private readonly TimeSpan window = TimeSpan.FromMinutes(Math.Max(1, config.GetValue("Auth:FailedTriesWindowMinutes", 15)));
    private readonly ConcurrentDictionary<string, List<DateTimeOffset>> failures = new();

    // How long until this name may try again, or null if it may try now
    public TimeSpan? WaitFor(string username)
    {
        if (!failures.TryGetValue(username, out var times)) return null;
        lock (times)
        {
            var now = DateTimeOffset.UtcNow;
            times.RemoveAll(t => now - t >= window);
            if (times.Count < limit) return null;
            return times[0] + window - now;
        }
    }

    public void Failed(string username)
    {
        // A flood of made-up names can't grow this forever: past a few thousand names the expired ones are dropped
        if (failures.Count > 5000) Sweep();
        var times = failures.GetOrAdd(username, _ => []);
        lock (times) times.Add(DateTimeOffset.UtcNow);
    }

    public void Succeeded(string username) => failures.TryRemove(username, out _);

    private void Sweep()
    {
        var now = DateTimeOffset.UtcNow;
        foreach (var (name, times) in failures)
        {
            lock (times)
            {
                times.RemoveAll(t => now - t >= window);
                if (times.Count == 0) failures.TryRemove(name, out _);
            }
        }
    }
}
