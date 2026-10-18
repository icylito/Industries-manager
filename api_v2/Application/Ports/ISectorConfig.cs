namespace api_v2.Application.Ports;

// The sector list the rules pick up from scripts/config.toml on startup. Null when there is no readable file.
public interface ISectorConfig
{
    Task<string?> ReadTextAsync(CancellationToken ct);
}
