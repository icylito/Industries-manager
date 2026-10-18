using api_v2.Domain.Entities;

namespace api_v2.Application.Ports;

// Accounts and sign in sessions: what the login, the password change and the "who am I" use cases need.
public interface IAccounts
{
    Task<User?> FindByUsernameAsync(string username, CancellationToken ct);

    // Tracked, because signing in and changing a password update the row they read
    Task<User> FindAsync(int id, CancellationToken ct);

    // Adds the new session, saves it, then clears the sessions that ran out
    Task AddSessionAsync(Session session, DateTimeOffset now, CancellationToken ct);

    Task DeleteSessionAsync(long sessionId, CancellationToken ct);

    // Everywhere else this person was signed in is signed out, except the session named here
    Task DeleteOtherSessionsAsync(int userId, long? keepSessionId, CancellationToken ct);

    Task SaveAsync(CancellationToken ct);
}
