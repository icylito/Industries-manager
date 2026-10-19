using api_v2.Domain.Collector;

namespace api_v2.Application.Ports;

// The retention setting lives in the AppSettings table so the team changes it from the page.
public interface ISettingsStore
{
    // Null when nothing was saved yet, so the configured starting values apply
    Task<Retention?> FindRetentionAsync(CancellationToken ct);

    Task SaveRetentionAsync(Retention retention, string changedBy, CancellationToken ct);
}
