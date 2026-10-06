using System.Text.Json;
using api_v2.Model;
using Microsoft.EntityFrameworkCore;

namespace api_v2.Data;

// How long the collector keeps old versions. Null means keep them all, pinned versions are always kept.
public record Retention(int? KeepVersions, int? KeepDays);

// Settings live in the AppSettings table so the team changes them from the page.
// appsettings.json gives the starting values (Collector:KeepVersions, Collector:KeepDays), nothing set means keep everything.
public class SettingsService(IConfiguration config)
{
    private const string RetentionKey = "retention";
    private static readonly JsonSerializerOptions Json = JsonSerializerOptions.Web;

    public Retention Retention { get; private set; } = new(null, null);

    public async Task LoadAsync(AppDbContext db, CancellationToken ct)
    {
        var row = await db.Settings.FindAsync([RetentionKey], ct);
        Retention = row is null
            ? new Retention(config.GetValue<int?>("Collector:KeepVersions"), config.GetValue<int?>("Collector:KeepDays"))
            : JsonSerializer.Deserialize<Retention>(row.Value, Json)!;
    }

    public static Dictionary<string, string[]> Check(Retention r)
    {
        var errors = new Dictionary<string, string[]>();
        if (r.KeepVersions is < 1 or > 10000) errors["keepVersions"] = ["Keep at least 1 version, or leave it empty to keep all"];
        if (r.KeepDays is < 1 or > 36500) errors["keepDays"] = ["Use 1 day or more, or leave it empty to never delete by age"];
        return errors;
    }

    public async Task SaveRetentionAsync(AppDbContext db, Retention retention, string changedBy, CancellationToken ct)
    {
        var row = await db.Settings.FindAsync([RetentionKey], ct);
        var value = JsonSerializer.Serialize(retention, Json);
        if (row is null)
        {
            db.Settings.Add(new AppSetting { Key = RetentionKey, Value = value, UpdatedAt = DateTimeOffset.UtcNow, UpdatedBy = changedBy });
        }
        else
        {
            row.Value = value;
            row.UpdatedAt = DateTimeOffset.UtcNow;
            row.UpdatedBy = changedBy;
        }
        await db.SaveChangesAsync(ct);
        Retention = retention;
    }
}
