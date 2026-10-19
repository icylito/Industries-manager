using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using api_v2.Application.Ports;
using api_v2.Domain.Entities;
using api_v2.Domain.Rules;
using api_v2.Domain.Tables;
using api_v2.Domain.Export;
using Microsoft.EntityFrameworkCore;

namespace api_v2.Infrastructure.Persistence;

// The tables from the Tables page, through EF: the table rows, the rows inside them, and the CSV download. Deleting
// a table for good takes its rows with it (cascade). The use case takes AppLock.UserTables around the changes that
// must not overlap, and every method here that touches more than one thing owns its own transaction.
public class UserTablesStore(AppDbContext db) : IUserTablesStore
{
    public async Task<IReadOnlyList<UserTableExpired>> DeleteExpiredAsync(DateTimeOffset cutoff, CancellationToken ct)
    {
        var expired = await db.UserTables
            .Where(t => t.DeletedAt != null && t.DeletedAt < cutoff)
            .Select(t => new UserTableExpired(t.Id, t.Name))
            .ToListAsync(ct);
        foreach (var table in expired)
        {
            await db.UserTables
                .Where(t => t.Id == table.Id && t.DeletedAt != null && t.DeletedAt < cutoff)
                .ExecuteDeleteAsync(ct);
        }
        return expired;
    }

    public async Task<IReadOnlyList<UserTableRecord>> ListLiveAsync(CancellationToken ct)
    {
        var tables = await db.UserTables.AsNoTracking().Where(t => t.DeletedAt == null)
            .OrderBy(t => t.Name).ToListAsync(ct);
        return tables.Select(Record).ToList();
    }

    public async Task<IReadOnlyList<UserTableRecord>> ListBinAsync(CancellationToken ct)
    {
        var tables = await db.UserTables.AsNoTracking().Where(t => t.DeletedAt != null)
            .OrderByDescending(t => t.DeletedAt).ToListAsync(ct);
        return tables.Select(Record).ToList();
    }

    public async Task<UserTableRecord?> FindLiveAsync(int id, CancellationToken ct)
    {
        var table = await db.UserTables.AsNoTracking().FirstOrDefaultAsync(t => t.Id == id && t.DeletedAt == null, ct);
        return table is null ? null : Record(table);
    }

    public async Task<UserTableCreateOutcome> CreateAsync(string name, string columns, string createdBy,
        CancellationToken ct)
    {
        if (await db.UserTables.CountAsync(t => t.DeletedAt == null, ct) >= TableLimits.Tables)
        {
            return new UserTableCreateOutcome.TooMany();
        }
        if (await NameTakenAsync(name, null, ct)) return new UserTableCreateOutcome.NameTaken();

        var now = Now();
        var table = new UserTable
        {
            Name = name, Columns = columns, CreatedBy = createdBy,
            CreatedAt = now, UpdatedAt = now, Version = 1,
        };
        db.UserTables.Add(table);
        await db.SaveChangesAsync(ct);
        return new UserTableCreateOutcome.Created(Record(table));
    }

    public async Task<UserTableUpdateOutcome> UpdateAsync(int id, string? name, IReadOnlyList<ColumnInput>? columns,
        int? version, CancellationToken ct)
    {
        var strategy = db.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync<UserTableUpdateOutcome>(async () =>
        {
            db.ChangeTracker.Clear();
            await using var tx = await db.Database.BeginTransactionAsync(ct);
            // FOR UPDATE: row changes read the columns FOR SHARE, so none can slip in under the old rules
            var table = (await db.UserTables
                .FromSql($"""SELECT * FROM "UserTables" WHERE "Id" = {id} AND "DeletedAt" IS NULL FOR UPDATE""")
                .ToListAsync(ct)).FirstOrDefault();
            if (table is null) return new UserTableUpdateOutcome.NotFound();
            if (version is int seen && seen != table.Version) return new UserTableUpdateOutcome.Stale();

            var errors = new Dictionary<string, string[]>();
            if (name is not null)
            {
                var (clean, problem) = TableShape.CheckName(name);
                if (problem is not null) errors["name"] = [problem];
                else if (await NameTakenAsync(clean!, id, ct)) return new UserTableUpdateOutcome.NameTaken(clean!);
                else table.Name = clean!;
            }

            if (columns is not null)
            {
                var before = TableShape.Parse(table.Columns);
                var (merged, columnErrors) = TableShape.Merge(before, columns);
                foreach (var (key, value) in columnErrors) errors[key] = value;
                if (errors.Count == 0)
                {
                    var blocked = await RecheckRowsAsync(table.Id, before, merged, ct);
                    if (blocked is not null) return blocked;
                    table.Columns = TableShape.Write(merged);
                }
            }
            if (errors.Count > 0) return new UserTableUpdateOutcome.Invalid(errors);

            table.Version += 1;
            table.UpdatedAt = Now();
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
            return new UserTableUpdateOutcome.Saved(Record(table));
        });
    }

    public async Task<DateTimeOffset?> DeleteAsync(int id, CancellationToken ct)
    {
        var now = Now();
        var changed = await db.UserTables.Where(t => t.Id == id && t.DeletedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.DeletedAt, now).SetProperty(t => t.Version, t => t.Version + 1), ct);
        return changed == 0 ? (DateTimeOffset?)null : now;
    }

    public async Task<UserTableRestoreOutcome> RestoreAsync(int id, CancellationToken ct)
    {
        var table = await db.UserTables.FirstOrDefaultAsync(t => t.Id == id && t.DeletedAt != null, ct);
        if (table is null) return new UserTableRestoreOutcome.NotFound();
        if (await db.UserTables.CountAsync(t => t.DeletedAt == null, ct) >= TableLimits.Tables)
        {
            return new UserTableRestoreOutcome.TooMany();
        }
        if (await NameTakenAsync(table.Name, id, ct)) return new UserTableRestoreOutcome.NameTaken(table.Name);
        table.DeletedAt = null;
        table.Version += 1;
        table.UpdatedAt = Now();
        await db.SaveChangesAsync(ct);
        return new UserTableRestoreOutcome.Restored(Record(table));
    }

    public async Task<UserTableRowsRecord?> RowsAsync(int id, string? q, string? sort, string? dir, int take, int skip,
        CancellationToken ct)
    {
        var table = await db.UserTables.AsNoTracking().FirstOrDefaultAsync(t => t.Id == id && t.DeletedAt == null, ct);
        if (table is null) return null;
        var columns = TableShape.Parse(table.Columns).Where(c => !c.Hidden).ToList();
        var keys = columns.Select(c => c.Key).ToArray();
        var needle = q?.Trim() ?? "";

        // The sort key is only ever one of the table's own keys, passed as a parameter, never pasted in
        var sortColumn = columns.FirstOrDefault(c => c.Key == sort);
        var sortKey = sortColumn?.Key ?? "";
        var numeric = sortColumn?.Type == "number";
        var descending = string.Equals(dir, "desc", StringComparison.OrdinalIgnoreCase);

        // The same search in all three queries, written out each time so every value stays a parameter
        var total = await db.Database.SqlQuery<int>(
            $"""SELECT count(*)::int AS "Value" FROM "UserTableRows" WHERE "TableId" = {id} AND ({needle} = '' OR EXISTS (SELECT 1 FROM jsonb_each_text("Data") e WHERE e.key = ANY({keys}) AND position(lower({needle}) in lower(e.value)) > 0))""").SingleAsync(ct);

        var rows = descending
            ? await db.UserTableRows.FromSql($"""
                SELECT * FROM "UserTableRows" WHERE "TableId" = {id} AND ({needle} = '' OR EXISTS (SELECT 1 FROM jsonb_each_text("Data") e WHERE e.key = ANY({keys}) AND position(lower({needle}) in lower(e.value)) > 0))
                ORDER BY CASE WHEN {numeric} THEN ("Data"->>{sortKey})::numeric END DESC NULLS LAST,
                         CASE WHEN NOT {numeric} THEN lower("Data"->>{sortKey}) END DESC NULLS LAST, "Id" DESC
                LIMIT {take} OFFSET {skip}
                """).AsNoTracking().ToListAsync(ct)
            : await db.UserTableRows.FromSql($"""
                SELECT * FROM "UserTableRows" WHERE "TableId" = {id} AND ({needle} = '' OR EXISTS (SELECT 1 FROM jsonb_each_text("Data") e WHERE e.key = ANY({keys}) AND position(lower({needle}) in lower(e.value)) > 0))
                ORDER BY CASE WHEN {numeric} THEN ("Data"->>{sortKey})::numeric END NULLS LAST,
                         CASE WHEN NOT {numeric} THEN lower("Data"->>{sortKey}) END NULLS LAST, "Id"
                LIMIT {take} OFFSET {skip}
                """).AsNoTracking().ToListAsync(ct);

        return new UserTableRowsRecord(total, rows.Select(RowRecord).ToList());
    }

    public async Task<UserTableRowAddOutcome> AddRowAsync(int id, Dictionary<string, JsonElement>? values,
        string createdBy, CancellationToken ct)
    {
        var strategy = db.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync<UserTableRowAddOutcome>(async () =>
        {
            db.ChangeTracker.Clear();
            await using var tx = await db.Database.BeginTransactionAsync(ct);
            var now = Now();
            // Counting the row in first holds the table, so the limit can't be raced past and the columns
            // can't change under this row
            var counted = await db.Database.ExecuteSqlAsync($"""
                UPDATE "UserTables" SET "RowCount" = "RowCount" + 1, "UpdatedAt" = {now}
                WHERE "Id" = {id} AND "DeletedAt" IS NULL AND "RowCount" < {TableLimits.Rows}
                """, ct);
            if (counted == 0)
            {
                var exists = await db.UserTables.AnyAsync(t => t.Id == id && t.DeletedAt == null, ct);
                if (!exists) return new UserTableRowAddOutcome.NotFound();
                return new UserTableRowAddOutcome.TooMany();
            }

            var columnsJson = await ColumnsAsync(id, ct);
            if (columnsJson is null) return new UserTableRowAddOutcome.NotFound();
            var columns = TableShape.Parse(columnsJson);
            var (data, errors) = TableShape.ReadRow(columns, values, null);
            if (errors.Count > 0) return new UserTableRowAddOutcome.Invalid(errors);

            var row = new UserTableRow
            {
                TableId = id, Data = data.ToJsonString(TableShape.Json), CreatedBy = createdBy, CreatedAt = now, UpdatedAt = now,
            };
            db.UserTableRows.Add(row);
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
            return new UserTableRowAddOutcome.Added(RowRecord(row));
        });
    }

    public async Task<UserTableRowUpdateOutcome> UpdateRowAsync(int id, int rowId,
        Dictionary<string, JsonElement>? values, DateTimeOffset? updatedAt, CancellationToken ct)
    {
        var strategy = db.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync<UserTableRowUpdateOutcome>(async () =>
        {
            db.ChangeTracker.Clear();
            await using var tx = await db.Database.BeginTransactionAsync(ct);
            var columnsJson = await ColumnsAsync(id, ct);
            if (columnsJson is null) return new UserTableRowUpdateOutcome.NotFoundTable();
            var row = (await db.UserTableRows
                .FromSql($"""SELECT * FROM "UserTableRows" WHERE "Id" = {rowId} AND "TableId" = {id} FOR UPDATE""")
                .ToListAsync(ct)).FirstOrDefault();
            if (row is null) return new UserTableRowUpdateOutcome.NotFoundRow();
            if (updatedAt is { } seen && seen != row.UpdatedAt) return new UserTableRowUpdateOutcome.Stale();

            var (data, errors) = TableShape.ReadRow(TableShape.Parse(columnsJson), values,
                JsonNode.Parse(row.Data) as JsonObject);
            if (errors.Count > 0) return new UserTableRowUpdateOutcome.Invalid(errors);

            row.Data = data.ToJsonString(TableShape.Json);
            row.UpdatedAt = Now();
            await db.SaveChangesAsync(ct);
            await db.UserTables.Where(t => t.Id == id).ExecuteUpdateAsync(s => s.SetProperty(t => t.UpdatedAt, row.UpdatedAt), ct);
            await tx.CommitAsync(ct);
            return new UserTableRowUpdateOutcome.Updated(RowRecord(row));
        });
    }

    public async Task<UserTableRowDeleteOutcome> DeleteRowAsync(int id, int rowId, CancellationToken ct)
    {
        var strategy = db.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync<UserTableRowDeleteOutcome>(async () =>
        {
            await using var tx = await db.Database.BeginTransactionAsync(ct);
            var removed = await db.UserTableRows.Where(r => r.Id == rowId && r.TableId == id).ExecuteDeleteAsync(ct);
            if (removed == 0) return new UserTableRowDeleteOutcome.NotFound();
            var now = Now();
            await db.Database.ExecuteSqlAsync($"""
                UPDATE "UserTables" SET "RowCount" = greatest("RowCount" - 1, 0), "UpdatedAt" = {now} WHERE "Id" = {id}
                """, ct);
            await tx.CommitAsync(ct);
            return new UserTableRowDeleteOutcome.Removed(rowId);
        });
    }

    public async Task<UserTableCsv?> CsvAsync(int id, CancellationToken ct)
    {
        var table = await db.UserTables.AsNoTracking().FirstOrDefaultAsync(t => t.Id == id && t.DeletedAt == null, ct);
        if (table is null) return null;
        var columns = TableShape.Parse(table.Columns).Where(c => !c.Hidden).ToList();
        return new UserTableCsv(TableShape.Slug(table.Name), Lines(id, columns, ct));
    }

    // Every row checked against the new columns before they are saved. A changed type rewrites the stored values
    // in the same transaction, so a column turned from number to text really holds text.
    private async Task<UserTableUpdateOutcome.RowsBlocked?> RecheckRowsAsync(int tableId,
        IReadOnlyList<FieldRule> before, IReadOnlyList<FieldRule> after, CancellationToken ct)
    {
        var old = before.ToDictionary(c => c.Key);
        var visibleBefore = before.Where(c => !c.Hidden).ToDictionary(c => c.Key);
        var tightened = after.Where(c => !c.Hidden && (!visibleBefore.TryGetValue(c.Key, out var was) || !was.Equals(c)))
            .ToList();
        if (tightened.Count == 0) return null;

        var retyped = after.Where(c => old.TryGetValue(c.Key, out var was) && was.Type != c.Type).Select(c => c.Key).ToHashSet();
        var blocked = 0;
        string? example = null;
        var rewrites = new List<(int Id, string Data)>();
        await foreach (var row in db.UserTableRows.AsNoTracking().Where(r => r.TableId == tableId).OrderBy(r => r.Id)
            .AsAsyncEnumerable().WithCancellation(ct))
        {
            if (JsonNode.Parse(row.Data) is not JsonObject data) continue;
            var (count, problem, rewritten) = TableShape.Recheck(after, data, retyped);
            if (count > 0)
            {
                blocked += 1;
                example ??= problem;
                continue;
            }
            if (rewritten is not null) rewrites.Add((row.Id, rewritten.ToJsonString(TableShape.Json)));
        }

        if (blocked > 0) return new UserTableUpdateOutcome.RowsBlocked(blocked, example);

        // Rewritten in batches, each value as a parameter
        foreach (var batch in rewrites.Chunk(1000))
        {
            var ids = batch.Select(b => b.Id).ToArray();
            var datas = batch.Select(b => b.Data).ToArray();
            await db.Database.ExecuteSqlAsync($"""
                UPDATE "UserTableRows" r SET "Data" = v.data::jsonb
                FROM unnest({ids}, {datas}) AS v(id, data) WHERE r."Id" = v.id
                """, ct);
        }
        return null;
    }

    // The table's columns, read FOR SHARE so a column change waits for this row change and the other way round.
    // Null when the table is gone or in the bin.
    private async Task<string?> ColumnsAsync(int id, CancellationToken ct) =>
        (await db.Database.SqlQuery<string>($"""
            SELECT "Columns"::text AS "Value" FROM "UserTables" WHERE "Id" = {id} AND "DeletedAt" IS NULL FOR SHARE
            """).ToListAsync(ct)).FirstOrDefault();

    // Live tables only, by the one name rule (Domain/Rules/Names.cs), the same comparison as the unique index
    private async Task<bool> NameTakenAsync(string name, int? exceptId, CancellationToken ct) =>
        await db.Database.SqlQuery<int>($"""
            SELECT count(*)::int AS "Value" FROM "UserTables"
            WHERE "DeletedAt" IS NULL AND "Name" COLLATE name_rule = {name} AND "Id" <> {exceptId ?? 0}
            """).SingleAsync(ct) > 0;

    // The visible columns as the CSV file lays them out: the header first, then the rows in id order.
    private async IAsyncEnumerable<string> Lines(int tableId, IReadOnlyList<FieldRule> columns,
        [EnumeratorCancellation] CancellationToken ct)
    {
        yield return string.Join(",", columns.Select(c => CsvText.Cell(CsvText.GuardFormula(c.Label))));
        await foreach (var row in db.UserTableRows.AsNoTracking().Where(r => r.TableId == tableId).OrderBy(r => r.Id)
            .AsAsyncEnumerable().WithCancellation(ct))
        {
            var data = JsonNode.Parse(row.Data) as JsonObject;
            var cells = columns.Select(c =>
            {
                var node = data?[c.Key];
                if (node is null) return "";
                var text = node.GetValueKind() == JsonValueKind.String ? node.GetValue<string>() : node.ToJsonString();
                return CsvText.Cell(c.Type == "text" ? CsvText.GuardFormula(text) : text);
            });
            yield return string.Join(",", cells);
        }
    }

    // Postgres keeps microseconds, .NET keeps 100 ns ticks: trimmed so a time sent back compares equal (see Scratchpad)
    private static DateTimeOffset Now()
    {
        var clock = DateTimeOffset.UtcNow;
        return new DateTimeOffset(clock.Ticks - clock.Ticks % TimeSpan.TicksPerMicrosecond, clock.Offset);
    }

    private static UserTableRecord Record(UserTable t) =>
        new(t.Id, t.Name, t.Columns, t.RowCount, t.CreatedBy, t.CreatedAt, t.UpdatedAt, t.DeletedAt, t.Version);

    private static UserTableRowRecord RowRecord(UserTableRow r) =>
        new(r.Id, r.Data, r.CreatedBy, r.CreatedAt, r.UpdatedAt);
}
