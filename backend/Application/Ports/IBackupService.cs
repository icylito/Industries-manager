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

    // The zip a backup downloads as, made on the spot and deleted once it has been read to the end and closed.
    // Null when there's no such backup.
    Stream? OpenZip(string id);

    // A place for an uploaded backup zip while it arrives. Disposing it removes whatever was written.
    IBackupUpload BeginUpload();

    // One file of a backup (main, collector or excel), opened in plain
    Task<BackupFileOpen> OpenFileAsync(string id, string file, CancellationToken ct);
}

// An uploaded zip on its way in: written through OpenWrite, then checked and added to the list by ImportAsync
public interface IBackupUpload : IDisposable
{
    Stream OpenWrite();

    Task<BackupEntry> ImportAsync(string by, long maxBytes, CancellationToken ct);
}

// Invalid: not a backup file name. Missing: no backup by that id. Found: the file, to be closed by the caller.
public abstract record BackupFileOpen
{
    public sealed record Invalid : BackupFileOpen;
    public sealed record Missing : BackupFileOpen;
    public sealed record Found(Stream Stream) : BackupFileOpen;
}
