using System.Text.Json;
using System.Text.Json.Nodes;
using api_v2.Application.Ports;
using api_v2.Domain.Tables;

namespace api_v2.Application.Tables;

// The Tables page: tables that managers and admins make, fill and delete. A change to a table takes AppLock.UserTables
// first, so two people can't both make the 50th one or change the same columns at once; the row locking and the
// transaction boundaries stay inside IUserTablesStore, which answers with what happened and the page reads it here.
public class UserTableService(IUserTablesStore store, IAppLocks locks)
{
    private const int PageSizeDefault = 25;
    private const int PageSizeMax = 100;

    public async Task<IReadOnlyList<UserTableDto>> ListAsync(CancellationToken ct) =>
        (await store.ListLiveAsync(ct)).Select(ToDto).ToList();

    // The bin: tables deleted in the last 14 days, newest first
    public async Task<IReadOnlyList<UserTableDto>> BinAsync(CancellationToken ct) =>
        (await store.ListBinAsync(ct)).Select(ToDto).ToList();

    public async Task<UserTableDto?> GetAsync(int id, CancellationToken ct)
    {
        var table = await store.FindLiveAsync(id, ct);
        return table is null ? null : ToDto(table);
    }

    public async Task<CreateTableResult> CreateAsync(string? rawName, IReadOnlyList<ColumnInput>? input,
        string createdBy, CancellationToken ct)
    {
        var (name, nameProblem) = TableShape.CheckName(rawName);
        var (columns, errors) = TableShape.Merge([], input);
        if (nameProblem is not null) errors["name"] = [nameProblem];
        if (errors.Count > 0) return new CreateTableResult.Invalid(errors);

        // One table made at a time, so two people can't both make the 50th
        await using var tablesLock = await locks.TakeAsync(AppLock.UserTables, ct);
        var outcome = await store.CreateAsync(name!, TableShape.Write(columns), createdBy, ct);
        if (outcome is UserTableCreateOutcome.Created created)
        {
            return new CreateTableResult.Created(ToDto(created.Table));
        }
        return outcome is UserTableCreateOutcome.TooMany
            ? new CreateTableResult.Limit()
            : new CreateTableResult.NameTaken(name!);
    }

    // Rename, or change the columns. A removed column is hidden with its values kept; a changed type or a
    // tighter rule is refused if any row would break, and the answer says how many rows are in the way.
    public async Task<UpdateTableResult> UpdateAsync(int id, string? name, IReadOnlyList<ColumnInput>? columns,
        int? version, CancellationToken ct)
    {
        await using var tablesLock = await locks.TakeAsync(AppLock.UserTables, ct);
        var outcome = await store.UpdateAsync(id, name, columns, version, ct);
        switch (outcome)
        {
            case UserTableUpdateOutcome.Saved saved:
                return new UpdateTableResult.Updated(ToDto(saved.Table));
            case UserTableUpdateOutcome.NotFound:
                return new UpdateTableResult.NotFound();
            case UserTableUpdateOutcome.Stale:
                return new UpdateTableResult.Stale();
            case UserTableUpdateOutcome.NameTaken taken:
                return new UpdateTableResult.NameTaken(taken.Name);
            case UserTableUpdateOutcome.Invalid invalid:
                return new UpdateTableResult.Invalid(invalid.Errors);
            case UserTableUpdateOutcome.RowsBlocked blocked:
                return new UpdateTableResult.RowsBlocked(RowsBlockedMessage(blocked.Blocked, blocked.Example));
            default:
                throw new InvalidOperationException("The tables store answered with something this use case doesn't know");
        }
    }

    // Into the bin. It comes back with Bring back for 14 days, then it is deleted for good.
    public async Task<DeleteTableResult> DeleteAsync(int id, CancellationToken ct)
    {
        await using var tablesLock = await locks.TakeAsync(AppLock.UserTables, ct);
        var deletedAt = await store.DeleteAsync(id, ct);
        if (deletedAt is null) return new DeleteTableResult.NotFound();
        return new DeleteTableResult.Deleted(id, deletedAt.Value + TableLimits.BinKeeps);
    }

    public async Task<RestoreTableResult> RestoreAsync(int id, CancellationToken ct)
    {
        await using var tablesLock = await locks.TakeAsync(AppLock.UserTables, ct);
        var outcome = await store.RestoreAsync(id, ct);
        switch (outcome)
        {
            case UserTableRestoreOutcome.Restored restored:
                return new RestoreTableResult.Restored(ToDto(restored.Table));
            case UserTableRestoreOutcome.NotFound:
                return new RestoreTableResult.NotFound();
            case UserTableRestoreOutcome.TooMany:
                return new RestoreTableResult.Limit();
            case UserTableRestoreOutcome.NameTaken taken:
                return new RestoreTableResult.NameTaken(taken.Name);
            default:
                throw new InvalidOperationException("The tables store answered with something this use case doesn't know");
        }
    }

    // A page of rows. Searching looks at the visible columns only; sorting is by one visible column.
    public async Task<RowsPageResult> RowsAsync(int id, string? q, string? sort, string? dir, int? page, int? size,
        CancellationToken ct)
    {
        var take = Math.Clamp(size ?? PageSizeDefault, 1, PageSizeMax);
        var skip = (Math.Max(page ?? 1, 1) - 1) * take;
        var found = await store.RowsAsync(id, q, sort, dir, take, skip, ct);
        if (found is null) return new RowsPageResult.NotFound();
        return new RowsPageResult.Found(new UserTablePage(found.Total, skip / take + 1, take,
            found.Rows.Select(RowDto).ToList()));
    }

    public async Task<AddRowResult> AddRowAsync(int id, Dictionary<string, JsonElement>? values, string createdBy,
        CancellationToken ct)
    {
        var outcome = await store.AddRowAsync(id, values, createdBy, ct);
        switch (outcome)
        {
            case UserTableRowAddOutcome.Added added:
                return new AddRowResult.Created(RowDto(added.Row));
            case UserTableRowAddOutcome.Invalid invalid:
                return new AddRowResult.Invalid(invalid.Errors);
            case UserTableRowAddOutcome.NotFound:
                return new AddRowResult.NotFound();
            case UserTableRowAddOutcome.TooMany:
                return new AddRowResult.Limit();
            default:
                throw new InvalidOperationException("The tables store answered with something this use case doesn't know");
        }
    }

    public async Task<UpdateRowResult> UpdateRowAsync(int id, int rowId, Dictionary<string, JsonElement>? values,
        DateTimeOffset? updatedAt, CancellationToken ct)
    {
        var outcome = await store.UpdateRowAsync(id, rowId, values, updatedAt, ct);
        switch (outcome)
        {
            case UserTableRowUpdateOutcome.Updated updated:
                return new UpdateRowResult.Updated(RowDto(updated.Row));
            case UserTableRowUpdateOutcome.NotFoundTable:
                return new UpdateRowResult.NotFoundTable();
            case UserTableRowUpdateOutcome.NotFoundRow:
                return new UpdateRowResult.NotFoundRow();
            case UserTableRowUpdateOutcome.Stale:
                return new UpdateRowResult.Stale();
            case UserTableRowUpdateOutcome.Invalid invalid:
                return new UpdateRowResult.Invalid(invalid.Errors);
            default:
                throw new InvalidOperationException("The tables store answered with something this use case doesn't know");
        }
    }

    public async Task<DeleteRowResult> DeleteRowAsync(int id, int rowId, CancellationToken ct)
    {
        var outcome = await store.DeleteRowAsync(id, rowId, ct);
        if (outcome is UserTableRowDeleteOutcome.NotFound) return new DeleteRowResult.NotFound();
        return new DeleteRowResult.Deleted(rowId);
    }

    // The visible columns as a CSV, made by the store as the rows are read
    public Task<UserTableCsv?> ExportAsync(int id, CancellationToken ct) => store.CsvAsync(id, ct);

    // What the page says when a column change would break rows: one sentence, with one row as the example
    private static string RowsBlockedMessage(int blocked, string? example)
    {
        var rows = blocked == 1 ? "1 row doesn't" : $"{blocked:N0} rows don't";
        return $"{rows} fit the new columns, so nothing was changed. For example: {example}";
    }

    private static UserTableDto ToDto(UserTableRecord t) =>
        new(t.Id, t.Name, TableShape.Parse(t.Columns), t.RowCount, t.CreatedBy, t.CreatedAt, t.UpdatedAt, t.DeletedAt,
            t.Version);

    private static UserTableRowDto RowDto(UserTableRowRecord r) =>
        new(r.Id, JsonNode.Parse(r.Data), r.CreatedBy, r.CreatedAt, r.UpdatedAt);
}
