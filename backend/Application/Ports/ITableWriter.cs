using System.Text.Json;
using System.Text.Json.Nodes;
using api_v2.Domain.Rules;

namespace api_v2.Application.Ports;

public record RowProblem(string Level, string Text);

// One old row after it's been fitted into today's table. Level "red" means data didn't make it, "black" is minor.
public record PlannedRow(int? OldId, string? Name, Dictionary<string, object?> Values, Dictionary<string, object?> Columns,
    JsonObject? Extra, List<string> Lost, List<RowProblem> Problems, int? SimilarTo, bool SimilarInBatch, string? Skip,
    int? KeepDuplicateOf, int? KeepImportedFrom);

// What importing or restoring a version would write
public record ImportPlan(long VersionId, bool RulesDiffer, List<string> UnmatchedColumns, List<PlannedRow> Rows)
{
    // True when two rows that would be restored as originals share a name, the unique index would refuse that.
    // Flagged copies keep their flag and don't count, nor do names of only symbols, same as the index. Planning
    // already flags the later of two names the one name rule says are the same, so this is only a last guard.
    public bool HasNameClash()
    {
        var names = Rows.Where(r => r.Skip is null && r.KeepDuplicateOf is null && !string.IsNullOrEmpty(r.Name) && !Names.HasNoLetters(r.Name))
            .Select(r => r.Name!).ToList();
        var seen = new HashSet<string>();
        return names.Any(n => !seen.Add(Names.Key(n)));
    }
}

// Reads old rows out of a collector version and fits them into today's table. The one-step restore doesn't appear
// here because it writes the rows inside its own transaction, see IHistoryRestoreRunner.
public interface ITableWriter
{
    // How the old rows fit today's columns and rules. Plans only; nothing is written.
    Task<ImportPlan> PlanAsync(VersionDetail version, bool forRestore, CancellationToken ct);

    // How many rows in today's table an earlier import took from this version
    Task<int> CountImportedFromAsync(long versionId, CancellationToken ct);

    // Adds the planned rows as new rows with new ids. Returns the new id and the saved row for each one.
    Task<List<(PlannedRow Row, int NewId, JsonElement Snapshot)>> ImportAsync(ImportPlan plan, CancellationToken ct);
}
