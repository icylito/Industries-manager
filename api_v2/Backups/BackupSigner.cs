using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace api_v2.Backups;

// Signs every backup this app makes, so an uploaded backup is only loaded when this app made it. Loading a dump
// runs whatever SQL is inside it, so a file from anywhere else must never reach pg_restore.
//
// signature.json holds the SHA-256 of each file in the backup and an HMAC-SHA256 over that list, keyed with the
// signing half of the key. The other half encrypts the dumps (see BackupCipher), so a backup copied off this
// computer can't be read or signed anywhere else.
//
// The key lives in Backup:SigningKeyFile (default backup-key/backup-signing.key at the repo root). It is wrapped with
// Windows DPAPI for this computer, so copying the file to another PC gives nothing usable: the other PC can't unwrap
// it, and this signer refuses to sign or trust backups rather than make a new key that would hide the problem.
public sealed class BackupSigner
{
    public const string SignatureFile = "signature.json";

    // The files a backup is made of. main.csv is optional (older backups have none), the rest are required.
    public static readonly string[] Files = ["main.dump", "collector.dump", "main.csv", "backup.json"];
    public static readonly string[] Required = ["main.dump", "collector.dump", "backup.json"];

    // The dumps and the Excel file are encrypted. backup.json and signature.json stay readable: they hold the list's
    // dates, sizes and row counts, and the signature needs them without the key.
    public static readonly string[] Sealed = ["main.dump", "collector.dump", "main.csv"];

    // Ties the wrapped key to this app, so a key blob from another program can't be unwrapped by accident
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("stock-listing backup key v1");

    private const int HalfKeySize = 32;

    // Signing half first, then the encryption half
    private readonly byte[]? _keys;
    private readonly string? _unavailable;

    public string KeyFile { get; }

    public BackupSigner(IConfiguration config, IWebHostEnvironment env, ILogger<BackupSigner> log)
    {
        var configured = config["Backup:SigningKeyFile"];
        KeyFile = string.IsNullOrWhiteSpace(configured)
            ? Path.GetFullPath(Path.Combine(env.ContentRootPath, "..", "backup-key", "backup-signing.key"))
            : Path.GetFullPath(configured.Trim(), env.ContentRootPath);

        if (!File.Exists(KeyFile))
        {
            Directory.CreateDirectory(Path.GetDirectoryName(KeyFile)!);
            _keys = RandomNumberGenerator.GetBytes(HalfKeySize * 2);
            Save(_keys);
            log.LogWarning("Made a new backup key at {KeyFile}. It only works on this computer, and backups made here can't be " +
                "opened on any other", KeyFile);
            return;
        }

        var stored = Convert.FromBase64String(File.ReadAllText(KeyFile).Trim());
        if (stored.Length == HalfKeySize)
        {
            // A key from before backups were locked to a computer. The signing half is kept, so backups already
            // made here still verify, and the encryption half is new.
            _keys = new byte[HalfKeySize * 2];
            stored.CopyTo(_keys, 0);
            RandomNumberGenerator.Fill(_keys.AsSpan(HalfKeySize));
            Save(_keys);
            log.LogWarning("Locked the backup key at {KeyFile} to this computer. Old backups are sealed the next time the API starts", KeyFile);
            return;
        }

        try
        {
            _keys = ProtectedData.Unprotect(stored, Entropy, DataProtectionScope.LocalMachine);
        }
        catch (CryptographicException)
        {
            _unavailable = $"The backup key in {KeyFile} was made on another computer, so backups can't be made or opened here. " +
                "Move the backup folder back to the computer that made it";
            log.LogError("{Message}", _unavailable);
        }
    }

    // The key that encrypts the dumps. Refuses when the key isn't this computer's.
    public byte[] SealKey => Keys()[HalfKeySize..].ToArray();

    // Written after backup.json, as the last file of a backup
    public async Task SignAsync(string dir, CancellationToken ct)
    {
        var hashes = new SortedDictionary<string, string>(StringComparer.Ordinal);
        foreach (var name in Files)
        {
            var path = Path.Combine(dir, name);
            if (File.Exists(path)) hashes[name] = await HashAsync(path, ct);
        }
        var doc = new SignatureJson(1, new Dictionary<string, string>(hashes), Mac(hashes));
        await File.WriteAllTextAsync(Path.Combine(dir, SignatureFile), JsonSerializer.Serialize(doc), ct);
    }

    // True only when signature.json is this app's, it names every file there and nothing more, and every file
    // still has the hash it was signed with
    public async Task<bool> VerifyAsync(string dir, CancellationToken ct)
    {
        var mac = await MacOfAsync(dir, ct);
        return mac is not null;
    }

    // The signature itself, when it is valid. Two uploads of the same backup carry the same one.
    public async Task<string?> MacOfAsync(string dir, CancellationToken ct)
    {
        if (_keys is null) return null;

        SignatureJson? doc;
        try
        {
            doc = JsonSerializer.Deserialize<SignatureJson>(await File.ReadAllTextAsync(Path.Combine(dir, SignatureFile), ct));
        }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException)
        {
            return null;
        }
        if (doc is not { Version: 1, Files: not null, Mac: not null }) return null;

        var signed = new SortedDictionary<string, string>(doc.Files, StringComparer.Ordinal);
        if (signed.Keys.Any(k => !Files.Contains(k)) || Required.Any(r => !signed.ContainsKey(r))) return null;

        var expected = Mac(signed);
        if (!CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(expected), Encoding.ASCII.GetBytes(doc.Mac)))
        {
            return null;
        }

        foreach (var name in Files)
        {
            var path = Path.Combine(dir, name);
            var present = File.Exists(path);
            if (present != signed.ContainsKey(name)) return null;
            if (present && !string.Equals(await HashAsync(path, ct), signed[name], StringComparison.Ordinal)) return null;
        }
        return expected;
    }

    // The signature a backup folder says it has, without checking it. Only used to spot the same backup twice.
    public static string? StoredMac(string dir)
    {
        try
        {
            return JsonSerializer.Deserialize<SignatureJson>(File.ReadAllText(Path.Combine(dir, SignatureFile)))?.Mac;
        }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    private byte[] Keys() => _keys ?? throw new BackupFailedException(_unavailable!);

    private string Mac(SortedDictionary<string, string> hashes)
    {
        var text = new StringBuilder("stock-listing-backup v1\n");
        foreach (var (name, hash) in hashes) text.Append(name).Append(':').Append(hash).Append('\n');
        return Convert.ToHexStringLower(HMACSHA256.HashData(Keys()[..HalfKeySize], Encoding.UTF8.GetBytes(text.ToString())));
    }

    // Wrapped for this computer and written over the old file in one step
    private void Save(byte[] keys)
    {
        var wrapped = ProtectedData.Protect(keys, Entropy, DataProtectionScope.LocalMachine);
        var temp = KeyFile + ".new";
        File.WriteAllText(temp, Convert.ToBase64String(wrapped));
        File.Move(temp, KeyFile, overwrite: true);
    }

    private static async Task<string> HashAsync(string path, CancellationToken ct)
    {
        await using var stream = File.OpenRead(path);
        return Convert.ToHexStringLower(await SHA256.HashDataAsync(stream, ct));
    }

    private sealed record SignatureJson(int Version, Dictionary<string, string>? Files, string? Mac);
}
