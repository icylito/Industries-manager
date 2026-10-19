using api_v2.Domain.Entities;

namespace api_v2.Application.Ports;

// Accounts and sign in sessions: what the login, the password change, the "who am I" and the account admin
// use cases need.
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

    void AddUser(User user);

    // True when another account has the username by the one name rule
    Task<bool> UsernameTakenAsync(string username, int? exceptId, CancellationToken ct);

    // After a rename or a delete, an account flagged for clashing may not clash any more, so its flag is cleared
    Task RefreshNameClashesAsync(CancellationToken ct);

    // The startup check that someone can always get in needs to know if any admin can still sign in
    Task<bool> AnyEnabledAdminAsync(CancellationToken ct);

    Task DeleteSessionsForUserAsync(int userId, CancellationToken ct);

    Task SaveAsync(CancellationToken ct);
}
