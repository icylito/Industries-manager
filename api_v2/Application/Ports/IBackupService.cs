namespace api_v2.Application.Ports;

// One saved backup, what GET /backups lists and what POST /backups returns.
public sealed record BackupEntry(
    string Id,
    DateTimeOffset CreatedAt,
    string Kind,
    string By,
    long MainSize,
    long CollectorSize,
    int RulesVersion,
    bool HasExcel,
    // Rows in the table when the copy was made. Backups from before this was recorded don't have it.
    int? RowCount = null,
    // The database layout at the time, so a restore knows if the table looked the same
    List<string>? Migrations = null,
    // Set for a backup that was dropped in from a file. It is kept 14 days from then, not from when it was made.
    DateTimeOffset? UploadedAt = null,
    // Has a signature.json, so its zip can be dropped back in. Backups from before signing don't.
    bool Signed = false);

// The backups kept on this computer: making one, listing, finding, deleting, downloading and dropping one back in.
public interface IBackupService
{
    // True when the id could name a backup, false for anything that isn't
    bool ValidId(string? id);

    // The sentence a backup failure can be shown with, or a shorter fallback for anything unexpected
    string PlainMessage(Exception ex);

    BackupEntry? Find(string id);

    void Delete(string id);

    IReadOnlyList<BackupEntry> List();

    object Status();

    // Runs pg_dump for main and the collector, one backup at a time
    Task<BackupEntry?> RunAsync(string kind, string by, CancellationToken ct);

    // The zip a backup downloads as
    string? ZipOf(string id);

    // A fresh temporary path for an uploaded backup
    string NewUploadPath();

    Task<BackupEntry> ImportAsync(string zipPath, string by, long maxBytes, CancellationToken ct);

    string? ResolveDump(string id, string file);

    Task<Stream> OpenFileAsync(string path, CancellationToken ct);
}
