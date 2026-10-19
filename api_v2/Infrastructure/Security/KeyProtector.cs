using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Text;

namespace api_v2.Infrastructure.Security;

// Wraps the backup key so the wrapped copy only opens on the computer that made it. Unprotect throws
// CryptographicException for a blob this computer can't open, which BackupSigner reads as "a key from another PC".
public interface IKeyProtector
{
    byte[] Protect(byte[] keys);
    byte[] Unprotect(byte[] wrapped);
}

// Windows DPAPI for this computer, the only wrapping the app uses. Kept apart so the signer itself has no Windows
// call in it, and a test host can swap this one piece without touching how backups are signed.
[SupportedOSPlatform("windows")]
public sealed class DpapiKeyProtector : IKeyProtector
{
    // Ties the wrapped key to this app, so a key blob from another program can't be unwrapped by accident
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("stock-listing backup key v1");

    public byte[] Protect(byte[] keys) => ProtectedData.Protect(keys, Entropy, DataProtectionScope.LocalMachine);

    public byte[] Unprotect(byte[] wrapped) => ProtectedData.Unprotect(wrapped, Entropy, DataProtectionScope.LocalMachine);

    // Backups are sealed to a Windows computer, so on anything else the API refuses to start rather than run
    // without a key it can trust
    public static IKeyProtector ForThisComputer() => OperatingSystem.IsWindows()
        ? new DpapiKeyProtector()
        : throw new PlatformNotSupportedException("Backups are sealed with Windows DPAPI, so the API runs on Windows only");
}
