using System.Security.Cryptography;
using api_v2.Infrastructure.Backups;
using api_v2.Infrastructure.Security;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging.Abstractions;

// Reads a backups folder and its key the way the app does, and says what opens here. It never makes or migrates a
// key and never changes a file, so it is safe to run on a copy from any computer.

var folder = Path.GetFullPath(Arg("--folder") ?? "backups");
var keyFile = Path.GetFullPath(Arg("--key") ?? Path.Combine("backup-key", "backup-signing.key"));
var failures = 0;

Console.WriteLine($"Backups: {folder}");
Console.WriteLine($"Key:     {keyFile}");
Console.WriteLine($"Computer: {Environment.MachineName}");
Console.WriteLine();

if (!File.Exists(keyFile))
{
    Console.WriteLine("NO KEY: there is no backup key in this copy, so none of its backups can be opened here.");
    return Finish(1);
}

byte[] stored;
try
{
    stored = Convert.FromBase64String(File.ReadAllText(keyFile).Trim());
}
catch (FormatException)
{
    Console.WriteLine("UNREADABLE KEY: the key file isn't in the expected form.");
    return Finish(1);
}
if (stored.Length == 32)
{
    // The app locks this kind of key the first time it starts. The check leaves files alone, so it stops here.
    Console.WriteLine("OLD KEY: this key was made before backups were locked to a computer. Start the app once to lock it, then run this check again.");
    return Finish(2);
}

var config = new ConfigurationBuilder()
    .AddInMemoryCollection(new Dictionary<string, string?> { ["Backup:SigningKeyFile"] = keyFile })
    .Build();
var signer = new BackupSigner(config, new Env(folder), KeyProtection.ForThisComputer(), NullLogger<BackupSigner>.Instance);

byte[] sealKey;
try
{
    sealKey = signer.SealKey;
}
catch (BackupFailedException ex)
{
    // The key blob was wrapped by another computer's Windows, so this computer can't unwrap it
    Console.WriteLine($"KEY LOCKED HERE: {ex.Message}.");
    Console.WriteLine("Nothing in this copy opens on this computer. That is the expected result on any computer other than the one that made the backups.");
    return Finish(1);
}

var backups = Directory.Exists(folder)
    ? Directory.GetDirectories(folder).Where(d => !Path.GetFileName(d).StartsWith('.') && File.Exists(Path.Combine(d, "backup.json"))).OrderBy(d => d).ToList()
    : [];
if (backups.Count == 0)
{
    Console.WriteLine("No backups found in that folder.");
    return Finish(0);
}

foreach (var dir in backups)
{
    var name = Path.GetFileName(dir);
    var signed = File.Exists(Path.Combine(dir, BackupSigner.SignatureFile));
    var signature = !signed ? "not signed" : await signer.MacOfAsync(dir, default) is null ? "signature FAILS" : "signature ok";
    var notes = new List<string>();
    var allOpen = true;

    foreach (var file in BackupSigner.Sealed)
    {
        var path = Path.Combine(dir, file);
        if (!File.Exists(path)) continue;
        if (!await BackupCipher.IsSealedAsync(path, default))
        {
            notes.Add($"{file} is NOT sealed");
            allOpen = false;
            continue;
        }
        try
        {
            // Reads every chunk, so a damaged or foreign file fails here, not only its header
            await using var stream = await BackupCipher.OpenReadAsync(path, sealKey, default);
            await stream.CopyToAsync(Stream.Null);
            notes.Add($"{file} opens");
        }
        catch (CryptographicException)
        {
            notes.Add($"{file} CANNOT be opened here");
            allOpen = false;
        }
    }

    // A backup from before signing has no signature to check, and is fine as long as its files open
    var verdict = allOpen && signature != "signature FAILS" ? "OK" : "PROBLEM";
    if (verdict != "OK") failures++;
    Console.WriteLine($"{verdict,-8}{name}  [{signature}]  {string.Join("; ", notes)}");
}

Console.WriteLine();
Console.WriteLine(failures == 0
    ? $"All {backups.Count} backup(s) open on this computer."
    : $"{failures} of {backups.Count} backup(s) did not open cleanly on this computer.");
return Finish(failures == 0 ? 0 : 1);

static string? Arg(string name)
{
    var args = Environment.GetCommandLineArgs();
    var at = Array.IndexOf(args, name);
    return at >= 0 && at + 1 < args.Length ? args[at + 1] : null;
}

static int Finish(int code) => code;

namespace api_v2.Backups
{
    public sealed class BackupFailedException(string message) : Exception(message);
}

// Only what BackupSigner reads from the host environment, pointed at the folder's parent
sealed class Env(string folder) : IWebHostEnvironment
{
    public string ApplicationName { get; set; } = "transfer-check";
    public IFileProvider ContentRootFileProvider { get; set; } = null!;
    public string ContentRootPath { get; set; } = Path.GetDirectoryName(folder) ?? folder;
    public string EnvironmentName { get; set; } = "Production";
    public IFileProvider WebRootFileProvider { get; set; } = null!;
    public string WebRootPath { get; set; } = "";
}
