namespace api_v2.Application.Ports;

// Who is making the request. The page sends the token from its sign in as "Authorization: Bearer ...".
// Nothing here runs until an endpoint asks, so open endpoints never touch the database for it.
public interface ICurrentUser
{
    // The username, or "guest" when nobody is signed in
    string Name { get; }
    bool IsAdmin { get; }
    // A manager, or an admin: the people who make and change tables on the Tables page and restore backups
    bool IsManager { get; }
    bool IsSignedIn { get; }
    int? Id { get; }
    long? SessionId { get; }
    // True for a new account or after a reset, until the person picks their own password
    bool MustChangePassword { get; }
    Task LoadAsync(CancellationToken ct = default);
}
