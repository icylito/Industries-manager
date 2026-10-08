using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using api_v2.Auth;
using api_v2.Data;
using api_v2.Model;
using Microsoft.EntityFrameworkCore;

namespace api_v2.Endpoints;

// What the page sends when it saves a board. updatedAt is the value it last read, so a save from a stale
// tab is refused instead of quietly writing over a newer board. See docs/plans/2026-10-08-scratchpad-canvas.md
public record ScratchBoardBody(JsonElement Document, DateTimeOffset? UpdatedAt);

public static class ScratchpadEndpoints
{
    // A fresh board: nothing on it, top left, at 100%
    private const string EmptyDocument = """{"version":1,"view":{"x":0,"y":0,"zoom":1},"items":[]}""";
    private const int MaxBytes = 1_000_000;
    private const int MaxItems = 500;
    private const int MaxText = 10_000;
    private const double MinZoom = 0.1;
    private const double MaxZoom = 4.0;
    // What may sit on the board. snap and file are reserved for later slices, see the brief.
    private static readonly string[] KnownTypes = ["industry", "note", "text", "snap", "file"];

    public static void MapScratchpad(this WebApplication app)
    {
        var group = app.MapGroup("/scratchpad").RequireDatabaseReady().RequireAdmin();

        // The person's own board. No row means a fresh empty board, and reading never writes one.
        group.MapGet("/", async (AppDbContext db, ICurrentUser user, CancellationToken ct) =>
        {
            var board = await db.ScratchBoards.AsNoTracking().FirstOrDefaultAsync(b => b.UserId == user.Id, ct);
            return Results.Ok(new
            {
                document = JsonNode.Parse(board?.Document ?? EmptyDocument),
                updatedAt = board?.UpdatedAt,
            });
        });

        // Saves the whole board. The page sends this on its own after every change, so there is no Save button.
        group.MapPut("/", async (ScratchBoardBody body, AppDbContext db, ICurrentUser user, AppLocks locks, CancellationToken ct) =>
        {
            var (document, errors) = Normalize(body.Document);
            if (errors.Count > 0) return Results.ValidationProblem(errors);

            // One board per person, so two saves for the same account take their turn
            await using var boardLock = await locks.TakeAsync(AppLock.Scratchpad, ct);
            var board = await db.ScratchBoards.FirstOrDefaultAsync(b => b.UserId == user.Id, ct);
            if (body.UpdatedAt is { } sent && board is not null && board.UpdatedAt != sent)
            {
                return Results.Problem("This board was changed somewhere else. Reload the page and try again",
                    statusCode: StatusCodes.Status409Conflict, title: "Changed meanwhile");
            }

            // Postgres keeps microseconds but .NET carries 100-nanosecond ticks, so drop the sub-microsecond
            // part before saving. Without this the value echoed below would not equal the one a later GET reads
            // back, and the guard would refuse the next save from a page that trusts this answer.
            var clock = DateTimeOffset.UtcNow;
            var now = new DateTimeOffset(clock.Ticks - clock.Ticks % TimeSpan.TicksPerMicrosecond, clock.Offset);
            if (board is null)
            {
                board = new ScratchBoard { UserId = user.Id!.Value, Document = document!, CreatedAt = now, UpdatedAt = now };
                db.ScratchBoards.Add(board);
            }
            else
            {
                board.Document = document!;
                board.UpdatedAt = now;
            }

            await db.SaveChangesAsync(ct);
            return Results.Ok(new { updatedAt = board.UpdatedAt });
        });

        // Clears the board. No button for it on the page yet, but an empty board is a board.
        group.MapDelete("/", async (AppDbContext db, ICurrentUser user, AppLocks locks, CancellationToken ct) =>
        {
            await using var boardLock = await locks.TakeAsync(AppLock.Scratchpad, ct);
            var board = await db.ScratchBoards.FirstOrDefaultAsync(b => b.UserId == user.Id, ct);
            if (board is not null)
            {
                db.ScratchBoards.Remove(board);
                await db.SaveChangesAsync(ct);
            }
            return Results.Ok(new { cleared = true });
        });
    }

    // Checks the document and hands it back with the view's numbers tidied, or the plain reasons it cannot
    // be saved. The document is free form, so this is done by hand rather than with data annotations.
    private static (string? Document, Dictionary<string, string[]> Errors) Normalize(JsonElement document)
    {
        if (document.ValueKind != JsonValueKind.Object)
        {
            return (null, new() { ["document"] = ["The board could not be read"] });
        }

        JsonNode? parsed;
        try
        {
            parsed = JsonNode.Parse(document.GetRawText());
        }
        catch
        {
            return (null, new() { ["document"] = ["The board could not be read"] });
        }

        if (parsed is not JsonObject root)
        {
            return (null, new() { ["document"] = ["The board could not be read"] });
        }

        var errors = new Dictionary<string, string[]>();

        if (!(root["version"] is JsonValue versionNode && versionNode.TryGetValue<double>(out var version) && version == 1))
        {
            errors["version"] = ["This board was made by a page this one does not know"];
        }

        if (root["view"] is JsonObject view)
        {
            var x = Finite(view["x"]) ? view["x"]!.GetValue<double>() : 0;
            var y = Finite(view["y"]) ? view["y"]!.GetValue<double>() : 0;
            var zoom = Finite(view["zoom"]) ? view["zoom"]!.GetValue<double>() : 1;
            view["x"] = x;
            view["y"] = y;
            view["zoom"] = Math.Clamp(zoom, MinZoom, MaxZoom);
        }
        else
        {
            root["view"] = new JsonObject { ["x"] = 0, ["y"] = 0, ["zoom"] = 1 };
        }

        if (root["items"] is not JsonArray items)
        {
            errors["items"] = ["The board's things could not be read"];
        }
        else
        {
            if (items.Count > MaxItems) errors["items"] = [$"A board holds at most {MaxItems} things"];

            for (var i = 0; i < items.Count && errors.Count == 0; i++)
            {
                if (items[i] is not JsonObject item)
                {
                    errors["items"] = ["The board's things could not be read"];
                    break;
                }

                var type = item["type"] is JsonValue typeNode && typeNode.TryGetValue<string>(out var name) ? name : null;
                if (type is null || !KnownTypes.Contains(type))
                {
                    errors["items"] = ["The board has something this page does not understand"];
                    break;
                }

                if (!Finite(item["x"]) || !Finite(item["y"]) || !Finite(item["w"]) || !Finite(item["h"]))
                {
                    errors["items"] = ["A thing on the board is in an impossible place"];
                    break;
                }

                if (item["text"] is JsonValue textNode && textNode.TryGetValue<string>(out var text) && text.Length > MaxText)
                {
                    errors["text"] = [$"A note holds at most {MaxText} characters"];
                    break;
                }
            }
        }

        if (errors.Count > 0) return (null, errors);

        var json = root.ToJsonString();
        if (Encoding.UTF8.GetByteCount(json) > MaxBytes)
        {
            return (null, new() { ["document"] = ["This board is too big to save"] });
        }

        return (json, errors);
    }

    private static bool Finite(JsonNode? value)
    {
        return value is JsonValue node && node.TryGetValue<double>(out var number) && double.IsFinite(number);
    }
}
