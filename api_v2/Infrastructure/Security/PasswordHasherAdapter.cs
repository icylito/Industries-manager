namespace api_v2.Infrastructure.Security;

// The application's view of the password hashing, so use cases never call the static helper directly
public class PasswordHasherAdapter : api_v2.Application.Ports.IPasswordHasher
{
    public string Hash(string password) => PasswordHasher.Hash(password);

    public bool Verify(string password, string stored, out bool needsRehash) =>
        PasswordHasher.Verify(password, stored, out needsRehash);

    public void VerifyDummy(string password) => PasswordHasher.VerifyDummy(password);

    public string? CheckNew(string? password, string username) => PasswordHasher.CheckNew(password, username);

    public string Generate() => PasswordHasher.Generate();
}
