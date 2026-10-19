namespace api_v2.Application.Ports;

// Whether a name is already in the table, by the one name rule. Rows flagged as copies (DuplicateOf set)
// don't count, the same as the unique index.
public interface INameIndex
{
    Task<bool> TakenAsync(string name, int? exceptId, CancellationToken ct = default);
}
