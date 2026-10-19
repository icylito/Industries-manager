namespace api_v2.Application.Ports;

// What POST /backups/{id}/restore gives back
public sealed record BackupRestoreResult(string Backup, int RowsBefore, int Rows, int RulesVersion, long? CopyId, string? UndoBackup = null);

// Puts the data back the way it was in a backup
public interface IBackupRestore
{
    // True when the backup's layout matches today's database, null when the backup didn't record it
    // The sentence a failed restore can be shown with
    string PlainMessage(Exception ex);

    bool? SameLayout(BackupEntry entry);

    Task<BackupRestoreResult> RunAsync(string id, string by, CancellationToken ct);
}
