using api_v2.Domain.Entities;
using api_v2.Domain.Rules;

namespace api_v2.Application.Ports;

// The RuleVersions table: the newest rules, every version's field JSON, and new versions.
public interface IRulesStore
{
    Task<RuleVersion?> LatestAsync(CancellationToken ct);

    // Every saved version's Fields JSON, so a deleted field can't come back under the same key
    Task<IReadOnlyList<string>> FieldsJsonAsync(CancellationToken ct);

    // Every saved version, newest first, for the History-style list the Fields page reads
    Task<IReadOnlyList<RuleVersion>> VersionsAsync(CancellationToken ct);

    Task<RuleVersion> InsertVersionAsync(RuleVersion version, CancellationToken ct);

    // Removes the custom field's values, closes the requests waiting on it and saves the new rules version,
    // all in one transaction. Answers the saved rules, how many rows lost a value and how many requests closed.
    Task<(RuleSet Saved, int RowsChanged, int RequestsClosed)> DeleteFieldAsync(
        string key, string label, IReadOnlyList<FieldRule> kept, string changedBy, CancellationToken ct);
}
