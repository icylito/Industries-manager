using System.Text.Json;
using api_v2.Domain.Tables;

namespace api_v2.Application.Ports;

// A table that has been in the bin long enough to be removed for good
public record UserTableExpired(int Id, string Name);

// One table from the Tables page as it is stored: its columns are still the JSON list they are kept as
public record UserTableRecord(int Id, string Name, string Columns, int RowCount, string CreatedBy,
    DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt, DateTimeOffset? DeletedAt, int Version);

// One row as it is stored: its values are still the JSON object they are kept as
public record UserTableRowRecord(int Id, string Data, string CreatedBy, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);

// A page of rows and how many rows match the search in all, before paging
public record UserTableRowsRecord(int Total, IReadOnlyList<UserTableRowRecord> Rows);

// A table's visible columns as CSV lines, in the order the file needs them, and the slug the download is named by.
// The lines are made as the rows are read, so a big table is never held in memory.
public record UserTableCsv(string Slug, IAsyncEnumerable<string> Lines);

// What making a table answered
public abstract record UserTableCreateOutcome
{
    public sealed record Created(UserTableRecord Table) : UserTableCreateOutcome;
    public sealed record TooMany : UserTableCreateOutcome;
    public sealed record NameTaken : UserTableCreateOutcome;
}

// What changing a table's name or columns answered. RowsBlocked carries what the recheck found.
public abstract record UserTableUpdateOutcome
{
    public sealed record Saved(UserTableRecord Table) : UserTableUpdateOutcome;
    public sealed record NotFound : UserTableUpdateOutcome;
    public sealed record Stale : UserTableUpdateOutcome;
    public sealed record NameTaken(string Name) : UserTableUpdateOutcome;
    public sealed record Invalid(IReadOnlyDictionary<string, string[]> Errors) : UserTableUpdateOutcome;
    public sealed record RowsBlocked(int Blocked, string? Example) : UserTableUpdateOutcome;
}

// What bringing a table back from the bin answered
public abstract record UserTableRestoreOutcome
{
    public sealed record Restored(UserTableRecord Table) : UserTableRestoreOutcome;
    public sealed record NotFound : UserTableRestoreOutcome;
    public sealed record TooMany : UserTableRestoreOutcome;
    public sealed record NameTaken(string Name) : UserTableRestoreOutcome;
}

// What adding a row answered
public abstract record UserTableRowAddOutcome
{
    public sealed record Added(UserTableRowRecord Row) : UserTableRowAddOutcome;
    public sealed record TooMany : UserTableRowAddOutcome;
    public sealed record NotFound : UserTableRowAddOutcome;
    public sealed record Invalid(IReadOnlyDictionary<string, string[]> Errors) : UserTableRowAddOutcome;
}

// What changing a row answered
public abstract record UserTableRowUpdateOutcome
{
    public sealed record Updated(UserTableRowRecord Row) : UserTableRowUpdateOutcome;
    public sealed record NotFoundTable : UserTableRowUpdateOutcome;
    public sealed record NotFoundRow : UserTableRowUpdateOutcome;
    public sealed record Stale : UserTableRowUpdateOutcome;
    public sealed record Invalid(IReadOnlyDictionary<string, string[]> Errors) : UserTableRowUpdateOutcome;
}

// What deleting a row answered
public abstract record UserTableRowDeleteOutcome
{
    public sealed record Removed(int Id) : UserTableRowDeleteOutcome;
    public sealed record NotFound : UserTableRowDeleteOutcome;
}

// The tables from the Tables page: reading them, making, renaming and deleting them, their rows, and the CSV
// download. The use case takes AppLock.UserTables and owns the order of the steps; every method here that changes
// more than one thing owns its own transaction, with the row locking kept inside it.
public interface IUserTablesStore
{
    // The tables that have sat in the bin past the cutoff, removed with their rows by the bin sweeper
    Task<IReadOnlyList<UserTableExpired>> DeleteExpiredAsync(DateTimeOffset cutoff, CancellationToken ct);

    // Live tables by name, and the bin newest first
    Task<IReadOnlyList<UserTableRecord>> ListLiveAsync(CancellationToken ct);

    Task<IReadOnlyList<UserTableRecord>> ListBinAsync(CancellationToken ct);

    Task<UserTableRecord?> FindLiveAsync(int id, CancellationToken ct);

    // Made and saved while the use case holds the table lock, so the count and the name check can't be raced
    Task<UserTableCreateOutcome> CreateAsync(string name, string columns, string createdBy, CancellationToken ct);

    // One transaction: the table is read FOR UPDATE, then its name and columns are checked, then every row is
    // rechecked before the new columns are written
    Task<UserTableUpdateOutcome> UpdateAsync(int id, string? name, IReadOnlyList<ColumnInput>? columns, int? version,
        CancellationToken ct);

    // Into the bin, answering the time it was saved with, or null when it was already gone
    Task<DateTimeOffset?> DeleteAsync(int id, CancellationToken ct);

    // Out of the bin, while the use case holds the table lock
    Task<UserTableRestoreOutcome> RestoreAsync(int id, CancellationToken ct);

    // A page of rows, or null when the table is gone or in the bin. take and skip are already clamped and computed.
    Task<UserTableRowsRecord?> RowsAsync(int id, string? q, string? sort, string? dir, int take, int skip,
        CancellationToken ct);

    // Each of these owns its transaction, with the table's columns read FOR SHARE and the row FOR UPDATE
    Task<UserTableRowAddOutcome> AddRowAsync(int id, Dictionary<string, JsonElement>? values, string createdBy,
        CancellationToken ct);

    Task<UserTableRowUpdateOutcome> UpdateRowAsync(int id, int rowId, Dictionary<string, JsonElement>? values,
        DateTimeOffset? updatedAt, CancellationToken ct);

    Task<UserTableRowDeleteOutcome> DeleteRowAsync(int id, int rowId, CancellationToken ct);

    // The visible columns as CSV, or null when the table is gone or in the bin
    Task<UserTableCsv?> CsvAsync(int id, CancellationToken ct);
}
