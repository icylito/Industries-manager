using System.Text.Json;
using System.Text.Json.Nodes;
using api_v2.Application.Auth;
using api_v2.Infrastructure.Security;
using api_v2.Application.Health;
using api_v2.Application.Hosted;
using api_v2.Application.Settings;
using api_v2.Application.Startup;
using api_v2.Infrastructure.Configuration;
using api_v2.Infrastructure.Export;
using api_v2.Infrastructure.Files;
using api_v2.Infrastructure.Persistence;
using api_v2.Domain.Entities;
using api_v2.Application.Hosted;
using api_v2.Domain.Scratchpad;
using api_v2.Presentation.Contracts;
using Microsoft.EntityFrameworkCore;

namespace api_v2.Presentation.Endpoints;

// What the page sends when it saves a board. updatedAt is the value it last read, so a save from a stale
// tab is refused instead of quietly writing over a newer board.
// A new board. With a document it starts as a copy of that, which is how "Keep mine as a new board" keeps
// changes a stale tab could not save.
// Renaming, pinning and where the person left the board. None of these is a change to the board itself.

// One row of the History tab

// The Scratchpad: a person's boards (each one endless canvas), their carry tray, and the files on their boards.
// Admin only for now, and every board, tray and file is the person's own: someone else's board answers 404.
public static class ScratchpadEndpoints
{
    private const string EmptyDocument = """{"version":1,"items":[],"lines":[],"groups":[]}""";
    private const int MaxBoards = 100;
    private const int MaxName = 60;
    private const int TrayMax = 20;

    public static void MapScratchpad(this WebApplication app)
    {
        var group = app.MapGroup("/scratchpad").RequireDatabaseReady().RequireAdmin();
        MapBoards(group);
        MapTray(group);
        group.MapScratchFiles();
    }

    private static void MapBoards(RouteGroupBuilder group)
    {
        // The History tab: pinned first, then the most recently changed
        group.MapGet("/boards", async (AppDbContext db, ICurrentUser user, CancellationToken ct) =>
        {
            var rows = await db.Database.SqlQuery<BoardSummary>($"""
                SELECT "Id", "Name", "Pinned", "CreatedAt", "UpdatedAt",
                       jsonb_array_length(COALESCE("Document"->'items', '[]'::jsonb)) AS "Things"
                FROM "ScratchBoards" WHERE "UserId" = {user.Id!.Value}
                ORDER BY "Pinned" DESC, "UpdatedAt" DESC, "Id" DESC
                """).ToListAsync(ct);
            return Results.Ok(rows);
        });

        group.MapPost("/boards", async (NewBoard body, AppDbContext db, ICurrentUser user, AppLocks locks, CancellationToken ct) =>
        {
            if (NameOf(body.Name) is { Length: > MaxName }) return NameTooLong();
            var name = NameOf(body.Name) ?? "New board";
            var document = EmptyDocument;
            if (body.Document is { ValueKind: not JsonValueKind.Null and not JsonValueKind.Undefined } given)
            {
                var (checkedDocument, errors) = BoardRules.Check(given);
                if (errors.Count > 0) return Results.ValidationProblem(errors);
                document = checkedDocument!;
            }

            var person = user.Id!.Value;
            await using var boardLock = await locks.TakeAsync(AppLock.Scratchpad, person, ct);
            if (await db.ScratchBoards.CountAsync(b => b.UserId == person, ct) >= MaxBoards)
            {
                return Results.Problem($"You can keep at most {MaxBoards} boards. Delete one you no longer need first.",
                    statusCode: StatusCodes.Status409Conflict, title: "Too many boards");
            }

            var now = Now();
            var board = new ScratchBoard { UserId = person, Name = name, Document = document, CreatedAt = now, UpdatedAt = now };
            db.ScratchBoards.Add(board);
            await db.SaveChangesAsync(ct);
            return Results.Created($"/scratchpad/boards/{board.Id}", Summary(board));
        });

        group.MapGet("/boards/{id:int}", async (int id, AppDbContext db, ICurrentUser user, CancellationToken ct) =>
        {
            var board = await db.ScratchBoards.AsNoTracking().FirstOrDefaultAsync(b => b.Id == id && b.UserId == user.Id, ct);
            if (board is null) return BoardNotFound();
            return Results.Ok(new
            {
                board.Id,
                board.Name,
                board.Pinned,
                document = JsonNode.Parse(board.Document),
                view = board.View is null ? null : JsonNode.Parse(board.View),
                board.CreatedAt,
                board.UpdatedAt,
            });
        });

        // Saves the whole board. The page sends this on its own after every change, so there is no Save button.
        group.MapPut("/boards/{id:int}", async (int id, BoardSave body, AppDbContext db, ICurrentUser user, AppLocks locks, CancellationToken ct) =>
        {
            var (document, errors) = BoardRules.Check(body.Document);
            if (errors.Count > 0) return Results.ValidationProblem(errors);

            // One person's saves take their turn, so two tabs can't both pass the check below at once
            await using var boardLock = await locks.TakeAsync(AppLock.Scratchpad, user.Id!.Value, ct);
            var board = await db.ScratchBoards.FirstOrDefaultAsync(b => b.Id == id && b.UserId == user.Id, ct);
            if (board is null) return BoardNotFound();
            if (body.UpdatedAt != board.UpdatedAt)
            {
                return Results.Problem("This board was changed somewhere else", statusCode: StatusCodes.Status409Conflict,
                    title: "Changed meanwhile");
            }

            board.Document = document!;
            board.UpdatedAt = Now();
            await db.SaveChangesAsync(ct);
            return Results.Ok(new { updatedAt = board.UpdatedAt });
        });

        // Rename, pin or unpin, and where the person left the board. Each touches one column and never the
        // document, so none of them makes an open tab's next save refuse.
        group.MapPatch("/boards/{id:int}", async (int id, BoardChange body, AppDbContext db, ICurrentUser user, CancellationToken ct) =>
        {
            var mine = db.ScratchBoards.Where(b => b.Id == id && b.UserId == user.Id);
            if (!await mine.AnyAsync(ct)) return BoardNotFound();

            if (body.Name is not null)
            {
                var name = NameOf(body.Name);
                if (name is null) return Results.ValidationProblem(new Dictionary<string, string[]> { ["name"] = ["Give the board a name"] });
                if (name.Length > MaxName) return NameTooLong();
                await mine.ExecuteUpdateAsync(s => s.SetProperty(b => b.Name, name), ct);
            }
            if (body.Pinned is bool pinned) await mine.ExecuteUpdateAsync(s => s.SetProperty(b => b.Pinned, pinned), ct);
            if (body.View is { ValueKind: JsonValueKind.Object } given && BoardRules.View(given) is string view)
            {
                await mine.ExecuteUpdateAsync(s => s.SetProperty(b => b.View, view), ct);
            }
            return Results.Ok(await mine.AsNoTracking().Select(b => new { b.Id, b.Name, b.Pinned }).FirstAsync(ct));
        });

        group.MapDelete("/boards/{id:int}", async (int id, AppDbContext db, ICurrentUser user, AppLocks locks, CancellationToken ct) =>
        {
            await using var boardLock = await locks.TakeAsync(AppLock.Scratchpad, user.Id!.Value, ct);
            var board = await db.ScratchBoards.FirstOrDefaultAsync(b => b.Id == id && b.UserId == user.Id, ct);
            if (board is null) return BoardNotFound();
            if (board.Pinned)
            {
                return Results.Problem("This board is pinned. Unpin it first.", statusCode: StatusCodes.Status409Conflict,
                    title: "Pinned");
            }
            db.ScratchBoards.Remove(board);
            await db.SaveChangesAsync(ct);
            // Its files stay for now: the sweep removes them a week after no board uses them
            return Results.Ok(new { deleted = 1, id });
        });
    }

    // The carry tray. A carry is one call, so when it answers the snapshot is saved, whatever any board is doing.
    private static void MapTray(RouteGroupBuilder group)
    {
        group.MapGet("/tray", async (AppDbContext db, ICurrentUser user, CancellationToken ct) =>
        {
            var tray = await db.ScratchTrays.AsNoTracking().FirstOrDefaultAsync(t => t.UserId == user.Id, ct);
            return Results.Ok(new { items = JsonNode.Parse(tray?.Items ?? "[]") });
        });

        // Puts a snapshot in the tray, at the end. The same snapshot carried again moves to the end instead of
        // showing twice, which is how undoing "put it on the board" gives it back.
        group.MapPost("/tray", async (JsonElement body, AppDbContext db, ICurrentUser user, AppLocks locks, CancellationToken ct) =>
        {
            if (BoardRules.Parse(body) is not JsonObject snap)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["snap"] = ["The snapshot could not be read"] });
            }
            var why = BoardRules.Snapshot(snap);
            if (why is not null) return Results.ValidationProblem(new Dictionary<string, string[]> { ["snap"] = [why] });

            var snapId = snap["id"]!.GetValue<string>();
            return await ChangeTray(db, user.Id!.Value, locks, items =>
            {
                Without(items, snapId);
                items.Add(snap);
                while (items.Count > TrayMax) items.RemoveAt(0);
            }, ct);
        });

        group.MapDelete("/tray/{snapId}", async (string snapId, AppDbContext db, ICurrentUser user, AppLocks locks, CancellationToken ct) =>
            await ChangeTray(db, user.Id!.Value, locks, items => Without(items, snapId), ct));
    }

    private static async Task<IResult> ChangeTray(AppDbContext db, int person, AppLocks locks, Action<JsonArray> change, CancellationToken ct)
    {
        await using var trayLock = await locks.TakeAsync(AppLock.Scratchpad, person, ct);
        var tray = await db.ScratchTrays.FirstOrDefaultAsync(t => t.UserId == person, ct);
        var items = JsonNode.Parse(tray?.Items ?? "[]") as JsonArray ?? [];
        change(items);
        var json = items.ToJsonString();
        if (tray is null)
        {
            db.ScratchTrays.Add(new ScratchTray { UserId = person, Items = json, UpdatedAt = Now() });
        }
        else
        {
            tray.Items = json;
            tray.UpdatedAt = Now();
        }
        await db.SaveChangesAsync(ct);
        return Results.Ok(new { items });
    }

    private static void Without(JsonArray items, string snapId)
    {
        for (var i = items.Count - 1; i >= 0; i--)
        {
            if (items[i] is JsonObject one && one["id"] is JsonValue value && value.TryGetValue<string>(out var id) && id == snapId)
            {
                items.RemoveAt(i);
            }
        }
    }

    // A name as the History tab shows it: trimmed and without control characters, or null when empty.
    // Longer than 60 is refused rather than cut, so a name is never saved other than as it was typed.
    private static string? NameOf(string? name)
    {
        if (name is null) return null;
        var clean = new string(name.Where(c => !char.IsControl(c)).ToArray()).Trim();
        return clean.Length == 0 ? null : clean;
    }

    private static IResult NameTooLong() =>
        Results.ValidationProblem(new Dictionary<string, string[]> { ["name"] = [$"A board name is at most {MaxName} characters"] });

    // Postgres keeps microseconds but .NET carries 100-nanosecond ticks, so drop the sub-microsecond part.
    // Without this the updatedAt a save answers would not equal the one a later read gives back, and the
    // guard would refuse the next save from a page that trusted the answer.
    private static DateTimeOffset Now()
    {
        var clock = DateTimeOffset.UtcNow;
        return new DateTimeOffset(clock.Ticks - clock.Ticks % TimeSpan.TicksPerMicrosecond, clock.Offset);
    }

    private static BoardSummary Summary(ScratchBoard board) =>
        new(board.Id, board.Name, board.Pinned, board.CreatedAt, board.UpdatedAt,
            (JsonNode.Parse(board.Document)?["items"] as JsonArray)?.Count ?? 0);

    private static IResult BoardNotFound() => Results.NotFound("There is no board with that id");
}
