namespace api_v2.Application.Ports;

// Passwords are never stored, only a salted hash that's slow on purpose. Checking new passwords against the
// rules is part of the password service too, so the use cases never decide the limits themselves.
public interface IPasswordHasher
{
    string Hash(string password);

    // True when the password matches. NeedsRehash is true when it was made with a lower cost than today's.
    bool Verify(string password, string stored, out bool needsRehash);

    // Checked against when the username doesn't exist, so a wrong name takes as long as a wrong password
    void VerifyDummy(string password);

    // The problem in plain words, or null when the new password is fine
    string? CheckNew(string? password, string username);

    // A random password that's easy to read out loud, for a new or reset account
    string Generate();
}
