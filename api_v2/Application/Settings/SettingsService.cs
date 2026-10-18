using api_v2.Application.Ports;
using api_v2.Domain.Collector;

namespace api_v2.Application.Settings;

// The retention setting as the app sees it. The row is read and written through ISettingsStore;
// appsettings.json gives the starting values (Collector:KeepVersions, Collector:KeepDays).
public class SettingsService(IConfiguration config)
{
    public Retention Retention { get; private set; } = new(null, null);

    public async Task LoadAsync(ISettingsStore store, CancellationToken ct)
    {
        Retention = await store.FindRetentionAsync(ct)
            ?? new Retention(config.GetValue<int?>("Collector:KeepVersions"), config.GetValue<int?>("Collector:KeepDays"));
    }

    public async Task SaveRetentionAsync(ISettingsStore store, Retention retention, string changedBy, CancellationToken ct)
    {
        await store.SaveRetentionAsync(retention, changedBy, ct);
        Retention = retention;
    }

    public static Dictionary<string, string[]> Check(Retention r) => RetentionRules.Check(r);
}