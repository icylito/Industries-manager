using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using api_v2.Auth;
using api_v2.Data;
using api_v2.Model;
using api_v2.Rules;
using api_v2.Tables;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace api_v2.Endpoints;

public record NewTableBody(string? Name, List<ColumnInput>? Columns);
public record EditTableBody(string? Name, List<ColumnInput>? Columns, int? Version);
public record RowBody(Dictionary<string, JsonElement>? Values, DateTimeOffset? UpdatedAt);

// The Tables page: tables that managers and admins make, fill and delete. They are rows in UserTables and
// UserTableRows, never real Postgres tables, so nothing here runs DDL and nothing a person types becomes SQL.
// Everyone signed in can read them; managers and admins change them.
public static class UserTableEndpoints
{
    private const int PageSizeDefault = 25;
    private const int PageSizeMax = 100;

    public static void MapUserTables(this WebApplication app)
    {
        var group = app.MapGroup("/tables").RequireDatabaseReady();

        group.MapGet("/", async (AppDbContext db, CancellationToken ct) =>
        {
            var tables = await db.UserTables.AsNoTracking().Where(t => t.DeletedAt == null)
                .OrderBy(t => t.Name).ToListAsync(ct);
            return Results.Ok(tables.Select(ToDto));
        }).RequireSignIn();

        // The bin: tables deleted in the last 14 days, newest first
        group.MapGet("/bin", async (AppDbContext db, CancellationToken ct) =>
        {
            var tables = await db.UserTables.AsNoTracking().Where(t => t.DeletedAt != null)
                .OrderByDescending(t => t.DeletedAt).ToListAsync(ct);
            return Results.Ok(tables.Select(ToDto));
        }).RequireManager();

        group.MapGet("/{id:int}", async (int id, AppDbContext db, CancellationToken ct) =>
        {
            var table = await db.UserTables.AsNoTracking().FirstOrDefaultAsync(t => t.Id == id && t.DeletedAt == null, ct);
            return table is null ? NoTable() : Results.Ok(ToDto(table));
        }).RequireSignIn();

        group.MapPost("/", async (NewTableBody body, AppDbContext db, ICurrentUser user, AppLocks locks,
            UserTableMirror mirror, CancellationToken ct) =>
        {
            var (name, nameProblem) = TableShape.CheckName(body.Name);
            var (columns, errors) = TableShape.Merge([], body.Columns);
            if (nameProblem is not null) errors["name"] = [nameProblem];
            if (errors.Count > 0) return Results.ValidationProblem(errors);

            // One table made at a time, so two people can't both make the 50th
            await using var tablesLock = await locks.TakeAsync(AppLock.UserTables, ct);
            if (await db.UserTables.CountAsync(t => t.DeletedAt == null, ct) >= TableLimits.Tables)
            {
                return Limit($"There can be at most {TableLimits.Tables} tables. Delete one first");
            }
            if (await NameTakenAsync(db, name!, null, ct)) return NameTaken(name!);

            var now = Now();
            var table = new UserTable
            {
                Name = name!, Columns = TableShape.Write(columns), CreatedBy = user.Name,
                CreatedAt = now, UpdatedAt = now, Version = 1,
            };
            db.UserTables.Add(table);
            await db.SaveChangesAsync(ct);
            mirror.Changed(table.Id);
            return Results.Created($"/tables/{table.Id}", ToDto(table));
        }).RequireManager();

        // Rename, or change the columns. A removed column is hidden with its values kept; a changed type or a
        // tighter rule is refused if any row would break, and the answer says how many rows are in the way.
        group.MapPut("/{id:int}", async (int id, EditTableBody body, AppDbContext db, AppLocks locks,
            UserTableMirror mirror, CancellationToken ct) =>
        {
            await using var tablesLock = await locks.TakeAsync(AppLock.UserTables, ct);
            var strategy = db.Database.CreateExecutionStrategy();
            return await strategy.ExecuteAsync(async () =>
            {
                db.ChangeTracker.Clear();
                await using var tx = await db.Database.BeginTransactionAsync(ct);
                // FOR UPDATE: row changes read the columns FOR SHARE, so none can slip in under the old rules
                var table = (await db.UserTables
                    .FromSql($"""SELECT * FROM "UserTables" WHERE "Id" = {id} AND "DeletedAt" IS NULL FOR UPDATE""")
                    .ToListAsync(ct)).FirstOrDefault();
                if (table is null) return NoTable();
                if (body.Version is int seen && seen != table.Version) return Stale();

                var errors = new Dictionary<string, string[]>();
                if (body.Name is not null)
                {
                    var (name, problem) = TableShape.CheckName(body.Name);
                    if (problem is not null) errors["name"] = [problem];
                    else if (await NameTakenAsync(db, name!, id, ct)) return NameTaken(name!);
                    else table.Name = name!;
                }

                if (body.Columns is not null)
                {
                    var before = TableShape.Parse(table.Columns);
                    var (columns, columnErrors) = TableShape.Merge(before, body.Columns);
                    foreach (var (key, value) in columnErrors) errors[key] = value;
                    if (errors.Count == 0)
                    {
                        var blocked = await RecheckRowsAsync(db, table.Id, before, columns, ct);
                        if (blocked is not null) return blocked;
                        table.Columns = TableShape.Write(columns);
                    }
                }
                if (errors.Count > 0) return Results.ValidationProblem(errors);

                table.Version += 1;
                table.UpdatedAt = Now();
                await db.SaveChangesAsync(ct);
                await tx.CommitAsync(ct);
                mirror.Changed(table.Id);
                return Results.Ok(ToDto(table));
            });
        }).RequireManager();

        // Into the bin. It comes back with Bring back for 14 days, then it is deleted for good.
        group.MapDelete("/{id:int}", async (int id, AppDbContext db, AppLocks locks, UserTableMirror mirror, CancellationToken ct) =>
        {
            await using var tablesLock = await locks.TakeAsync(AppLock.UserTables, ct);
            var now = Now();
            var changed = await db.UserTables.Where(t => t.Id == id && t.DeletedAt == null)
                .ExecuteUpdateAsync(s => s.SetProperty(t => t.DeletedAt, now).SetProperty(t => t.Version, t => t.Version + 1), ct);
            if (changed == 0) return NoTable();
            mirror.Changed(id);
            return Results.Ok(new { deleted = id, keptUntil = now + TableLimits.BinKeeps });
        }).RequireManager();

        group.MapPost("/{id:int}/restore", async (int id, AppDbContext db, AppLocks locks, UserTableMirror mirror, CancellationToken ct) =>
        {
            await using var tablesLock = await locks.TakeAsync(AppLock.UserTables, ct);
            var table = await db.UserTables.FirstOrDefaultAsync(t => t.Id == id && t.DeletedAt != null, ct);
            if (table is null) return Results.NotFound("That table isn't in the bin");
            if (await db.UserTables.CountAsync(t => t.DeletedAt == null, ct) >= TableLimits.Tables)
            {
                return Limit($"There can be at most {TableLimits.Tables} tables. Delete one first");
            }
            if (await NameTakenAsync(db, table.Name, id, ct))
            {
                return Results.Conflict($"There's already a table called {table.Name}. Rename that one first");
            }
            table.DeletedAt = null;
            table.Version += 1;
            table.UpdatedAt = Now();
            await db.SaveChangesAsync(ct);
            mirror.Changed(id);
            return Results.Ok(ToDto(table));
        }).RequireManager();

        // A page of rows. Searching looks at the visible columns only; sorting is by one visible column.
        group.MapGet("/{id:int}/rows", async (int id, string? q, string? sort, string? dir, int? page, int? size,
            AppDbContext db, CancellationToken ct) =>
        {
            var table = await db.UserTables.AsNoTracking().FirstOrDefaultAsync(t => t.Id == id && t.DeletedAt == null, ct);
            if (table is null) return NoTable();
            var columns = TableShape.Parse(table.Columns).Where(c => !c.Hidden).ToList();
            var keys = columns.Select(c => c.Key).ToArray();
            var needle = q?.Trim() ?? "";
            var take = Math.Clamp(size ?? PageSizeDefault, 1, PageSizeMax);
            var skip = (Math.Max(page ?? 1, 1) - 1) * take;

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

            return Results.Ok(new { total, page = skip / take + 1, size = take, rows = rows.Select(RowDto) });
        }).RequireSignIn();

        group.MapPost("/{id:int}/rows", async (int id, RowBody body, AppDbContext db, ICurrentUser user,
            UserTableMirror mirror, CancellationToken ct) =>
        {
            var strategy = db.Database.CreateExecutionStrategy();
            return await strategy.ExecuteAsync(async () =>
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
                    return exists ? Limit($"A table can have at most {TableLimits.Rows:N0} rows") : NoTable();
                }

                var columnsJson = await ColumnsAsync(db, id, ct);
                if (columnsJson is null) return NoTable();
                var columns = TableShape.Parse(columnsJson);
                var (data, errors) = TableShape.ReadRow(columns, body.Values, null);
                if (errors.Count > 0) return Results.ValidationProblem(errors);

                var row = new UserTableRow
                {
                    TableId = id, Data = data.ToJsonString(TableShape.Json), CreatedBy = user.Name, CreatedAt = now, UpdatedAt = now,
                };
                db.UserTableRows.Add(row);
                await db.SaveChangesAsync(ct);
                await tx.CommitAsync(ct);
                mirror.Changed(id);
                return Results.Created($"/tables/{id}/rows/{row.Id}", RowDto(row));
            });
        }).RequireManager();

        group.MapPut("/{id:int}/rows/{rowId:int}", async (int id, int rowId, RowBody body, AppDbContext db,
            UserTableMirror mirror, CancellationToken ct) =>
        {
            var strategy = db.Database.CreateExecutionStrategy();
            return await strategy.ExecuteAsync(async () =>
            {
                db.ChangeTracker.Clear();
                await using var tx = await db.Database.BeginTransactionAsync(ct);
                var columnsJson = await ColumnsAsync(db, id, ct);
                if (columnsJson is null) return NoTable();
                var row = (await db.UserTableRows
                    .FromSql($"""SELECT * FROM "UserTableRows" WHERE "Id" = {rowId} AND "TableId" = {id} FOR UPDATE""")
                    .ToListAsync(ct)).FirstOrDefault();
                if (row is null) return Results.NotFound("That row isn't there any more. Reload the table");
                if (body.UpdatedAt is { } seen && seen != row.UpdatedAt) return Stale();

                var (data, errors) = TableShape.ReadRow(TableShape.Parse(columnsJson), body.Values,
                    JsonNode.Parse(row.Data) as JsonObject);
                if (errors.Count > 0) return Results.ValidationProblem(errors);

                row.Data = data.ToJsonString(TableShape.Json);
                row.UpdatedAt = Now();
                await db.SaveChangesAsync(ct);
                await db.UserTables.Where(t => t.Id == id).ExecuteUpdateAsync(s => s.SetProperty(t => t.UpdatedAt, row.UpdatedAt), ct);
                await tx.CommitAsync(ct);
                mirror.Changed(id);
                return Results.Ok(RowDto(row));
            });
        }).RequireManager();

        group.MapDelete("/{id:int}/rows/{rowId:int}", async (int id, int rowId, AppDbContext db,
            UserTableMirror mirror, CancellationToken ct) =>
        {
            var strategy = db.Database.CreateExecutionStrategy();
            return await strategy.ExecuteAsync(async () =>
            {
                await using var tx = await db.Database.BeginTransactionAsync(ct);
                var removed = await db.UserTableRows.Where(r => r.Id == rowId && r.TableId == id).ExecuteDeleteAsync(ct);
                if (removed == 0) return Results.NotFound("That row isn't there any more. Reload the table");
                var now = Now();
                await db.Database.ExecuteSqlAsync($"""
                    UPDATE "UserTables" SET "RowCount" = greatest("RowCount" - 1, 0), "UpdatedAt" = {now} WHERE "Id" = {id}
                    """, ct);
                await tx.CommitAsync(ct);
                mirror.Changed(id);
                return Results.Ok(new { deleted = rowId });
            });
        }).RequireManager();

        // The visible columns as a CSV that opens cleanly in Excel
        group.MapGet("/{id:int}/export.csv", async (int id, HttpContext http, AppDbContext db, CancellationToken ct) =>
        {
            var table = await db.UserTables.AsNoTracking().FirstOrDefaultAsync(t => t.Id == id && t.DeletedAt == null, ct);
            if (table is null) return NoTable();
            var columns = TableShape.Parse(table.Columns).Where(c => !c.Hidden).ToList();

            http.Response.ContentType = "text/csv; charset=utf-8";
            http.Response.Headers.ContentDisposition = $"attachment; filename=\"{TableShape.Slug(table.Name)}.csv\"";
            await using var writer = new StreamWriter(http.Response.Body, new UTF8Encoding(true));
            await writer.WriteLineAsync(string.Join(",", columns.Select(c => CsvText.Cell(CsvText.GuardFormula(c.Label)))));
            await foreach (var row in db.UserTableRows.AsNoTracking().Where(r => r.TableId == id).OrderBy(r => r.Id)
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
                await writer.WriteLineAsync(string.Join(",", cells));
            }
            return Results.Empty;
        }).RequireSignIn();
    }

    // Every row checked against the new columns before they are saved. A changed type rewrites the stored values
    // in the same transaction, so a column turned from number to text really holds text.
    private static async Task<IResult?> RecheckRowsAsync(AppDbContext db, int tableId, IReadOnlyList<FieldRule> before,
        IReadOnlyList<FieldRule> after, CancellationToken ct)
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

        if (blocked > 0)
        {
            var rows = blocked == 1 ? "1 row doesn't" : $"{blocked:N0} rows don't";
            return Results.Problem($"{rows} fit the new columns, so nothing was changed. For example: {example}",
                statusCode: StatusCodes.Status409Conflict, title: "Rows in the way");
        }

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
    private static async Task<string?> ColumnsAsync(AppDbContext db, int id, CancellationToken ct) =>
        (await db.Database.SqlQuery<string>($"""
            SELECT "Columns"::text AS "Value" FROM "UserTables" WHERE "Id" = {id} AND "DeletedAt" IS NULL FOR SHARE
            """).ToListAsync(ct)).FirstOrDefault();

    // Live tables only, ignoring case and outer spaces, the same comparison as the unique index
    private static async Task<bool> NameTakenAsync(AppDbContext db, string name, int? exceptId, CancellationToken ct) =>
        await db.Database.SqlQuery<int>($"""
            SELECT count(*)::int AS "Value" FROM "UserTables"
            WHERE "DeletedAt" IS NULL AND lower(btrim("Name")) = lower(btrim({name})) AND "Id" <> {exceptId ?? 0}
            """).SingleAsync(ct) > 0;

    // Postgres keeps microseconds, .NET keeps 100 ns ticks: trimmed so a time sent back compares equal (see Scratchpad)
    private static DateTimeOffset Now()
    {
        var clock = DateTimeOffset.UtcNow;
        return new DateTimeOffset(clock.Ticks - clock.Ticks % TimeSpan.TicksPerMicrosecond, clock.Offset);
    }


    private static object ToDto(UserTable t) => new
    {
        t.Id, t.Name, Columns = TableShape.Parse(t.Columns), t.RowCount, t.CreatedBy, t.CreatedAt, t.UpdatedAt, t.DeletedAt, t.Version,
    };

    private static object RowDto(UserTableRow r) => new { r.Id, Data = JsonNode.Parse(r.Data), r.CreatedBy, r.CreatedAt, r.UpdatedAt };

    private static IResult NoTable() => Results.NotFound("There's no such table. It may have been deleted, reload the page");

    private static IResult NameTaken(string name) => Results.Conflict($"There's already a table called {name}");

    private static IResult Stale() => Results.Problem("Someone else changed this at the same time. Reload and try again",
        statusCode: StatusCodes.Status409Conflict, title: "Changed meanwhile");

    private static IResult Limit(string message) => Results.Problem(message, statusCode: StatusCodes.Status409Conflict,
        title: "Limit reached");
}
