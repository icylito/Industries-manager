using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace api_v2.Backups;

// Signs every backup this app makes, so an uploaded backup is only loaded when this app made it. Loading a dump
// runs whatever SQL is inside it, so a file from anywhere else must never reach pg_restore.
//
// signature.json holds the SHA-256 of each file in the backup and an HMAC-SHA256 over that list, keyed with a
// secret only this server has (Backup:SigningKeyFile, default backup-key/backup-signing.key at the repo root,
// made on first start). Anyone holding the key can make a backup the app trusts, so it lives outside the backups
// folder and outside git.
public sealed class BackupSigner
{
    public const string SignatureFile = "signature.json";

    // The files a backup is made of. main.csv is optional (older backups have none), the rest are required.
    public static readonly string[] Files = ["main.dump", "collector.dump", "main.csv", "backup.json"];
    public static readonly string[] Required = ["main.dump", "collector.dump", "backup.json"];

    private readonly byte[] _key;

    public string KeyFile { get; }

    public BackupSigner(IConfiguration config, IWebHostEnvironment env, ILogger<BackupSigner> log)
    {
        var configured = config["Backup:SigningKeyFile"];
        KeyFile = string.IsNullOrWhiteSpace(configured)
            ? Path.GetFullPath(Path.Combine(env.ContentRootPath, "..", "backup-key", "backup-signing.key"))
            : Path.GetFullPath(configured.Trim(), env.ContentRootPath);

        if (File.Exists(KeyFile))
        {
            _key = Convert.FromBase64String(File.ReadAllText(KeyFile).Trim());
            if (_key.Length < 32) throw new InvalidOperationException($"{KeyFile} is too short to sign backups with");
        }
        else
        {
            Directory.CreateDirectory(Path.GetDirectoryName(KeyFile)!);
            _key = RandomNumberGenerator.GetBytes(32);
            File.WriteAllText(KeyFile, Convert.ToBase64String(_key));
            log.LogWarning("Made a new key for signing backups at {KeyFile}. Keep it safe and out of git: backups are only " +
                "accepted back by an app with this same key", KeyFile);
        }
    }

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

    private string Mac(SortedDictionary<string, string> hashes)
    {
        var text = new StringBuilder("stock-listing-backup v1\n");
        foreach (var (name, hash) in hashes) text.Append(name).Append(':').Append(hash).Append('\n');
        return Convert.ToHexStringLower(HMACSHA256.HashData(_key, Encoding.UTF8.GetBytes(text.ToString())));
    }

    private static async Task<string> HashAsync(string path, CancellationToken ct)
    {
        await using var stream = File.OpenRead(path);
        return Convert.ToHexStringLower(await SHA256.HashDataAsync(stream, ct));
    }

    private sealed record SignatureJson(int Version, Dictionary<string, string>? Files, string? Mac);
}
