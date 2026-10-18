using System.Security.Cryptography;
using System.Text;

namespace api_v2.Infrastructure.Security;

// Passwords are never stored, only a salted PBKDF2 hash that's slow on purpose.
// The stored text says how it was made, so the cost can go up later and old hashes still check.
public static class PasswordHasher
{
    private const int Iterations = 600_000;
    private const int SaltBytes = 16;
    private const int HashBytes = 32;
    private const string Scheme = "pbkdf2-sha256";

    // Checked against when the username doesn't exist, so a wrong name takes as long as a wrong password
    private static readonly string Dummy = Hash("not a real password");

    public static string Hash(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(SaltBytes);
        var hash = Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(password), salt, Iterations, HashAlgorithmName.SHA256, HashBytes);
        return $"{Scheme}${Iterations}${Convert.ToBase64String(salt)}${Convert.ToBase64String(hash)}";
    }

    // True when the password matches. NeedsRehash is true when it was made with a lower cost than today's.
    public static bool Verify(string password, string stored, out bool needsRehash)
    {
        needsRehash = false;
        var parts = stored.Split('$');
        if (parts.Length != 4 || parts[0] != Scheme || !int.TryParse(parts[1], out var iterations) || iterations < 1)
        {
            return false;
        }
        byte[] salt, expected;
        try
        {
            salt = Convert.FromBase64String(parts[2]);
            expected = Convert.FromBase64String(parts[3]);
        }
        catch (FormatException)
        {
            return false;
        }
        var actual = Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(password), salt, iterations, HashAlgorithmName.SHA256, expected.Length);
        var ok = CryptographicOperations.FixedTimeEquals(actual, expected);
        needsRehash = ok && iterations < Iterations;
        return ok;
    }

    public static void VerifyDummy(string password) => Verify(password, Dummy, out _);

    // A random password that's easy to read out loud: no 0/O or 1/l/I
    public static string Generate(int length = 16)
    {
        const string alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        return string.Create(length, 0, (span, _) =>
        {
            for (var i = 0; i < span.Length; i++) span[i] = alphabet[RandomNumberGenerator.GetInt32(alphabet.Length)];
        });
    }

    public static string? CheckNew(string? password, string username)
    {
        if (string.IsNullOrEmpty(password) || password.Length < 10) return "The password has to be at least 10 characters";
        if (password.Length > 128) return "The password can be at most 128 characters";
        if (string.Equals(password, username, StringComparison.OrdinalIgnoreCase)) return "The password can't be the same as the username";
        return null;
    }
}
