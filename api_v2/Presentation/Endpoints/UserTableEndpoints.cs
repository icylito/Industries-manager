using System.Text;
using api_v2.Application.Ports;
using api_v2.Application.Tables;
using api_v2.Domain.Tables;
using api_v2.Presentation.Authorization;
using api_v2.Presentation.Contracts;

namespace api_v2.Presentation.Endpoints;

// The Tables page: tables that managers and admins make, fill and delete. They are rows in UserTables and
// UserTableRows, never real Postgres tables, so nothing here runs DDL and nothing a person types becomes SQL.
// Everyone signed in can read them; managers and admins change them. Each endpoint binds its input, calls one
// use case in Application/Tables and turns the answer into an HTTP result.
public static class UserTableEndpoints
{
    public static void MapUserTables(this WebApplication app)
    {
        var group = app.MapGroup("/tables").RequireDatabaseReady();

        group.MapGet("/", async (UserTableService tables, CancellationToken ct) =>
            Results.Ok(await tables.ListAsync(ct))).RequireSignIn();

        // The bin: tables deleted in the last 14 days, newest first
        group.MapGet("/bin", async (UserTableService tables, CancellationToken ct) =>
            Results.Ok(await tables.BinAsync(ct))).RequireManager();

        group.MapGet("/{id:int}", async (int id, UserTableService tables, CancellationToken ct) =>
        {
            var table = await tables.GetAsync(id, ct);
            return table is null ? NoTable() : Results.Ok(table);
        }).RequireSignIn();

        group.MapPost("/", async (NewTableBody body, UserTableService tables, ICurrentUser user, CancellationToken ct) =>
        {
            var result = await tables.CreateAsync(body.Name, body.Columns, user.Name, ct);
            return result switch
            {
                CreateTableResult.Created created => Results.Created($"/tables/{created.Table.Id}", created.Table),
                CreateTableResult.Invalid invalid => Results.ValidationProblem(invalid.Errors),
                CreateTableResult.NameTaken taken => NameTaken(taken.Name),
                _ => Limit($"There can be at most {TableLimits.Tables} tables. Delete one first")
            };
        }).RequireManager();

        // Rename, or change the columns. A removed column is hidden with its values kept; a changed type or a
        // tighter rule is refused if any row would break, and the answer says how many rows are in the way.
        group.MapPut("/{id:int}", async (int id, EditTableBody body, UserTableService tables, CancellationToken ct) =>
        {
            var result = await tables.UpdateAsync(id, body.Name, body.Columns, body.Version, ct);
            return result switch
            {
                UpdateTableResult.Updated updated => Results.Ok(updated.Table),
                UpdateTableResult.NotFound => NoTable(),
                UpdateTableResult.Stale => Stale(),
                UpdateTableResult.NameTaken taken => NameTaken(taken.Name),
                UpdateTableResult.Invalid invalid => Results.ValidationProblem(invalid.Errors),
                _ => RowsInTheWay(((UpdateTableResult.RowsBlocked)result).Message)
            };
        }).RequireManager();

        // Into the bin. It comes back with Bring back for 14 days, then it is deleted for good.
        group.MapDelete("/{id:int}", async (int id, UserTableService tables, CancellationToken ct) =>
        {
            var result = await tables.DeleteAsync(id, ct);
            return result is DeleteTableResult.Deleted deleted
                ? Results.Ok(new { deleted = deleted.Id, keptUntil = deleted.KeptUntil })
                : NoTable();
        }).RequireManager();

        group.MapPost("/{id:int}/restore", async (int id, UserTableService tables, CancellationToken ct) =>
        {
            var result = await tables.RestoreAsync(id, ct);
            return result switch
            {
                RestoreTableResult.Restored restored => Results.Ok(restored.Table),
                RestoreTableResult.NotFound => Results.NotFound("That table isn't in the bin"),
                RestoreTableResult.NameTaken taken => RestoreNameTaken(taken.Name),
                _ => Limit($"There can be at most {TableLimits.Tables} tables. Delete one first")
            };
        }).RequireManager();

        // A page of rows. Searching looks at the visible columns only; sorting is by one visible column.
        group.MapGet("/{id:int}/rows", async (int id, string? q, string? sort, string? dir, int? page, int? size,
            UserTableService tables, CancellationToken ct) =>
        {
            var result = await tables.RowsAsync(id, q, sort, dir, page, size, ct);
            return result switch
            {
                RowsPageResult.Found found => Results.Ok(found.Page),
                _ => NoTable()
            };
        }).RequireSignIn();

        group.MapPost("/{id:int}/rows", async (int id, RowBody body, UserTableService tables, ICurrentUser user,
            CancellationToken ct) =>
        {
            var result = await tables.AddRowAsync(id, body.Values, user.Name, ct);
            return result switch
            {
                AddRowResult.Created created => Results.Created($"/tables/{id}/rows/{created.Row.Id}", created.Row),
                AddRowResult.Invalid invalid => Results.ValidationProblem(invalid.Errors),
                AddRowResult.NotFound => NoTable(),
                _ => Limit($"A table can have at most {TableLimits.Rows:N0} rows")
            };
        }).RequireManager();

        group.MapPut("/{id:int}/rows/{rowId:int}", async (int id, int rowId, RowBody body, UserTableService tables,
            CancellationToken ct) =>
        {
            var result = await tables.UpdateRowAsync(id, rowId, body.Values, body.UpdatedAt, ct);
            return result switch
            {
                UpdateRowResult.Updated updated => Results.Ok(updated.Row),
                UpdateRowResult.Invalid invalid => Results.ValidationProblem(invalid.Errors),
                UpdateRowResult.NotFoundTable => NoTable(),
                UpdateRowResult.Stale => Stale(),
                _ => RowGone()
            };
        }).RequireManager();

        group.MapDelete("/{id:int}/rows/{rowId:int}", async (int id, int rowId, UserTableService tables,
            CancellationToken ct) =>
        {
            var result = await tables.DeleteRowAsync(id, rowId, ct);
            return result is DeleteRowResult.Deleted
                ? Results.Ok(new { deleted = rowId })
                : RowGone();
        }).RequireManager();

        // The visible columns as a CSV that opens cleanly in Excel
        group.MapGet("/{id:int}/export.csv", async (int id, HttpContext http, UserTableService tables,
            CancellationToken ct) =>
        {
            var csv = await tables.ExportAsync(id, ct);
            if (csv is null) return NoTable();

            http.Response.ContentType = "text/csv; charset=utf-8";
            http.Response.Headers.ContentDisposition = $"attachment; filename=\"{csv.Slug}.csv\"";
            await using var writer = new StreamWriter(http.Response.Body, new UTF8Encoding(true));
            await foreach (var line in csv.Lines.WithCancellation(ct))
            {
                await writer.WriteLineAsync(line);
            }
            return Results.Empty;
        }).RequireSignIn();
    }

    private static IResult NoTable() => Results.NotFound("There's no such table. It may have been deleted, reload the page");

    private static IResult RowGone() => Results.NotFound("That row isn't there any more. Reload the table");

    private static IResult NameTaken(string name) => Results.Conflict($"There's already a table called {name}");

    private static IResult RestoreNameTaken(string name) =>
        Results.Conflict($"There's already a table called {name}. Rename that table to something else");

    private static IResult Stale() => Results.Problem("Someone else did a change at the same time. Reload and try again later",
        statusCode: StatusCodes.Status409Conflict, title: "Changed meanwhile");

    private static IResult Limit(string message) => Results.Problem(message, statusCode: StatusCodes.Status409Conflict,
        title: "Limit reached");

    private static IResult RowsInTheWay(string message) => Results.Problem(message,
        statusCode: StatusCodes.Status409Conflict, title: "Rows in the way");
}
