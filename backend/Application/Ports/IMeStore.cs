using api_v2.Domain.Entities;

namespace api_v2.Application.Ports;

// The signed in person's own settings row
public interface IMeStore
{
    Task<UserSettings?> FindAsync(int userId, CancellationToken ct);

    void Add(UserSettings settings);

    // False when another tab made the row at the same moment, so this save was one row late
    Task<bool> SaveAsync(CancellationToken ct);
}
