using api_v2.Application.Health;
using api_v2.Application.Ports;

namespace api_v2.Application.Backups;

public sealed record RestorePreview(string Id, DateTimeOffset CreatedAt, int RulesVersion, int? RowCount, bool? SameLayout,
    int CurrentRows, bool HistoryReady);

// What a restore from a backup would do, put together from the backup, the live table and History. Nothing changes.
public sealed class BackupPreview(IBackupService backups, IBackupRestore restore, IIndustryStore industries, DatabaseStatus status)
{
    public async Task<RestorePreview?> RestoreAsync(string id, CancellationToken ct)
    {
        var entry = backups.Find(id);
        if (entry is null) return null;
        return new RestorePreview(entry.Id, entry.CreatedAt, entry.RulesVersion, entry.RowCount, restore.SameLayout(entry),
            await industries.CountAsync(ct), status.HistoryReady);
    }
}
