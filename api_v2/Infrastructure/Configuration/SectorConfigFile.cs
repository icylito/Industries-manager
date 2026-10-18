using api_v2.Application.Ports;

namespace api_v2.Infrastructure.Configuration;

// Finds the sector list file the rules pick up on startup and reads it. A missing or broken file is not an error,
// it just means the rules stay as they are.
public class SectorConfigFile(IConfiguration config, IWebHostEnvironment env, ILogger<SectorConfigFile> log) : ISectorConfig
{
    public async Task<string?> ReadTextAsync(CancellationToken ct)
    {
        var configured = config["Rules:ConfigToml"];
        var path = string.IsNullOrWhiteSpace(configured)
            ? Path.GetFullPath(Path.Combine(env.ContentRootPath, "..", "scripts", "config.toml"))
            : configured;
        if (!File.Exists(path))
        {
            log.LogWarning("No sector list at {Path}, keeping the current rules", path);
            return null;
        }
        try
        {
            return await File.ReadAllTextAsync(path, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "Couldn't read the sector list at {Path}, keeping the current rules", path);
            return null;
        }
    }
}
