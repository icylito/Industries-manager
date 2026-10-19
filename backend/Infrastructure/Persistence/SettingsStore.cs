using System.Text.Json;
using api_v2.Application.Ports;
using api_v2.Domain.Collector;
using api_v2.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace api_v2.Infrastructure.Persistence;

// The retention row in AppSettings, through EF
public class SettingsStore(AppDbContext db) : ISettingsStore
{
    private const string RetentionKey = "retention";
    private static readonly JsonSerializerOptions Json = JsonSerializerOptions.Web;

    public async Task<Retention?> FindRetentionAsync(CancellationToken ct)
    {
        var row = await db.Settings.FindAsync([RetentionKey], ct);
        return row is null ? null : JsonSerializer.Deserialize<Retention>(row.Value, Json);
    }

    public async Task SaveRetentionAsync(Retention retention, string changedBy, CancellationToken ct)
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
    }
}
