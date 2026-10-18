using System.Text.Json;
using api_v2.Domain.Rules;

namespace api_v2.Application.History;

// One saved version as the History list shows it. SameLayout says if the table looked the same back then.
public record VersionListItem(long Id, DateTimeOffset CreatedAt, string Reason, string CreatedBy, int RowCount,
    int? RulesVersion, bool Pinned, bool Damaged, bool SameLayout);

// One version with its columns, the rules it was saved under and its rows, for View
public record VersionView(long Id, DateTimeOffset CreatedAt, string Reason, string CreatedBy, int RowCount,
    int? RulesVersion, bool Pinned, bool Damaged, bool SameLayout, IReadOnlyList<string> Columns,
    List<FieldRule>? Rules, List<JsonElement> Rows);

// A version as the CSV file the download route answers with
public record VersionDownload(byte[] Bytes, string FileName);

// One old row as an import preview lists it
public record ImportPreviewRow(int? OldId, string? Name, Dictionary<string, object?> Values, string? Level,
    IEnumerable<string> Problems, int? SimilarTo, bool SimilarInBatch, string? Skip);

// What an import from this version would add, nothing gets written
public record ImportPreview(long VersionId, bool RulesDiffer, string? Message, List<string> UnmatchedColumns,
    int Total, int WillImport, int AlreadyImportedFromThisVersion, IEnumerable<string?> Skipped,
    IEnumerable<ImportPreviewRow> Rows);

public abstract record DeleteVersionResult
{
    public sealed record Deleted(long Id) : DeleteVersionResult;
    public sealed record NotFound : DeleteVersionResult;
    public sealed record Pinned : DeleteVersionResult;
}

public abstract record RestoreResult
{
    public sealed record Done(int Restored, IEnumerable<string?> Skipped, int LostValues, bool RulesRestored,
        int? RequestId) : RestoreResult;
    public sealed record Invalid(IReadOnlyDictionary<string, string[]> Errors) : RestoreResult;
    public sealed record NotFound : RestoreResult;
    public sealed record Damaged : RestoreResult;
    public sealed record NameClash : RestoreResult;
    public sealed record BackupFailed(string What) : RestoreResult;
}

public abstract record ImportPreviewResult
{
    public sealed record Preview(ImportPreview View) : ImportPreviewResult;
    public sealed record NotFound : ImportPreviewResult;
    public sealed record Damaged : ImportPreviewResult;
}

public abstract record ImportResult
{
    public sealed record Imported(int Count, int Similar, int LostValues, int BreakingRules, IEnumerable<string?> Skipped,
        int LeftOutDuplicates, List<int> RequestIds) : ImportResult;
    public sealed record NeedsConfirm : ImportResult;
    public sealed record NeedsDecision(int Similar, int Total, int AlreadyImportedFromThisVersion, string Message) : ImportResult;
    public sealed record NothingNew : ImportResult;
    public sealed record NotFound : ImportResult;
    public sealed record Damaged : ImportResult;
    public sealed record BackupFailed(string What) : ImportResult;
}

public abstract record RetentionPreviewResult
{
    public sealed record Preview(int WillRemove) : RetentionPreviewResult;
    public sealed record Invalid(IReadOnlyDictionary<string, string[]> Errors) : RetentionPreviewResult;
}

public abstract record RetentionSaveResult
{
    public sealed record Saved(int? KeepVersions, int? KeepDays, int? Removed, string? Note) : RetentionSaveResult;
    public sealed record Invalid(IReadOnlyDictionary<string, string[]> Errors) : RetentionSaveResult;
}
