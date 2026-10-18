using System.Text.Json;
using System.Text.Json.Nodes;
using api_v2.Application.Ports;
using api_v2.Domain.Entities;
using api_v2.Domain.Scratchpad;

namespace api_v2.Application.Scratchpad;

// The Scratchpad's boards and carry tray. Every board and tray is the person's own, so each call carries their id
// and someone else's board is simply not there. A change takes that person's Scratchpad lock first, so two tabs of
// the same person take their turn instead of writing over each other, and the board's rules are checked before the
// lock is taken so a board that can't be saved never waits on one.
public class ScratchpadService(IScratchpadStore store, IAppLocks locks)
{
    public const string ChangedMeanwhileMessage = "This board was changed somewhere else";

    // The most boards one person can keep
    public const int MaxBoards = 100;

    // The longest a board name may be. Longer is refused rather than cut, so a name is never saved other than as
    // it was typed.
    private const int MaxName = 60;

    // The most snapshots the carry tray holds. The oldest goes when a new one would make it more.
    private const int TrayMax = 20;

    // What a new board starts as
    private const string EmptyDocument = """{"version":1,"items":[],"lines":[],"groups":[]}""";

    // The History tab: pinned first, then the most recently changed
    public Task<IReadOnlyList<ScratchBoardSummary>> BoardsAsync(int person, CancellationToken ct) =>
        store.SummariesAsync(person, ct);

    // One board with its document and its view, or null when it isn't this person's
    public async Task<BoardDetail?> GetAsync(int id, int person, CancellationToken ct)
    {
        var board = await store.ReadAsync(id, person, ct);
        if (board is null) return null;
        return new BoardDetail(board.Id, board.Name, board.Pinned,
            JsonNode.Parse(board.Document),
            board.View is null ? null : JsonNode.Parse(board.View),
            board.CreatedAt, board.UpdatedAt);
    }

    // A new board. With a document it starts as a copy of that, which is how "Keep mine as a new board" keeps
    // changes a stale tab could not save.
    public async Task<CreateBoardResult> CreateAsync(int person, string? name, JsonElement? document, CancellationToken ct)
    {
        var trimmed = NameOf(name);
        if (trimmed is { Length: > MaxName }) return new CreateBoardResult.Invalid(NameTooLong());
        var boardName = trimmed ?? "New board";
        var json = EmptyDocument;
        if (document is { ValueKind: not JsonValueKind.Null and not JsonValueKind.Undefined } given)
        {
            var (checkedDocument, errors) = BoardRules.Check(given);
            if (errors.Count > 0) return new CreateBoardResult.Invalid(errors);
            json = checkedDocument!;
        }

        await using var boardLock = await locks.TakeAsync(AppLock.Scratchpad, person, ct);
        if (await store.CountBoardsAsync(person, ct) >= MaxBoards)
        {
            return new CreateBoardResult.TooMany();
        }

        var now = Now();
        var board = new ScratchBoard { UserId = person, Name = boardName, Document = json, CreatedAt = now, UpdatedAt = now };
        store.Add(board);
        await store.SaveAsync(ct);
        return new CreateBoardResult.Created(board);
    }

    // Saves the whole board. The page sends this on its own after every change, and it sends the updatedAt it last
    // read, so a save from a stale tab is refused instead of quietly writing over a newer board.
    public async Task<SaveBoardResult> SaveAsync(int id, int person, JsonElement document, DateTimeOffset? seen, CancellationToken ct)
    {
        var (checkedDocument, errors) = BoardRules.Check(document);
        if (errors.Count > 0) return new SaveBoardResult.Invalid(errors);

        // One person's saves take their turn, so two tabs can't both pass the check below at once
        await using var boardLock = await locks.TakeAsync(AppLock.Scratchpad, person, ct);
        var board = await store.FindAsync(id, person, ct);
        if (board is null) return new SaveBoardResult.NotFound();
        if (seen != board.UpdatedAt)
        {
            return new SaveBoardResult.ChangedMeanwhile();
        }

        board.Document = checkedDocument!;
        board.UpdatedAt = Now();
        await store.SaveAsync(ct);
        return new SaveBoardResult.Saved(board.UpdatedAt);
    }

    // Rename, pin or unpin, and where the person left the board. Each touches one column and never the document,
    // so none of them makes an open tab's next save refuse.
    public async Task<ChangeBoardResult> ChangeAsync(
        int id, int person, string? name, bool? pinned, JsonElement? view, CancellationToken ct)
    {
        if (!await store.ExistsAsync(id, person, ct)) return new ChangeBoardResult.NotFound();

        if (name is not null)
        {
            var clean = NameOf(name);
            if (clean is null)
            {
                return new ChangeBoardResult.Invalid(new Dictionary<string, string[]> { ["name"] = ["Give the board a name"] });
            }
            if (clean.Length > MaxName) return new ChangeBoardResult.Invalid(NameTooLong());
            await store.RenameAsync(id, person, clean, ct);
        }
        if (pinned is bool pin) await store.PinAsync(id, person, pin, ct);
        if (view is { ValueKind: JsonValueKind.Object } given && BoardRules.View(given) is string placed)
        {
            await store.MoveViewAsync(id, person, placed, ct);
        }
        return new ChangeBoardResult.Changed(await store.BriefAsync(id, person, ct));
    }

    public async Task<DeleteBoardResult> DeleteAsync(int id, int person, CancellationToken ct)
    {
        await using var boardLock = await locks.TakeAsync(AppLock.Scratchpad, person, ct);
        var board = await store.FindAsync(id, person, ct);
        if (board is null) return new DeleteBoardResult.NotFound();
        if (board.Pinned) return new DeleteBoardResult.Pinned();
        store.Remove(board);
        // Its files stay for now: the sweep removes them a week after no board uses them
        await store.SaveAsync(ct);
        return new DeleteBoardResult.Deleted();
    }

    // The tray as the page shows it, which is an empty list until something is carried
    public async Task<JsonNode?> TrayAsync(int person, CancellationToken ct)
    {
        var tray = await store.ReadTrayAsync(person, ct);
        return JsonNode.Parse(tray?.Items ?? "[]");
    }

    // Puts a snapshot in the tray, at the end. The same snapshot carried again moves to the end instead of
    // showing twice, which is how undoing "put it on the board" gives it back.
    public async Task<TrayResult> AddToTrayAsync(int person, JsonElement body, CancellationToken ct)
    {
        if (BoardRules.Parse(body) is not JsonObject snap)
        {
            return new TrayResult.Invalid(new Dictionary<string, string[]> { ["snap"] = ["The snapshot could not be read"] });
        }
        var why = BoardRules.Snapshot(snap);
        if (why is not null) return new TrayResult.Invalid(new Dictionary<string, string[]> { ["snap"] = [why] });

        var snapId = snap["id"]!.GetValue<string>();
        return await ChangeTrayAsync(person, items =>
        {
            Without(items, snapId);
            items.Add(snap);
            while (items.Count > TrayMax) items.RemoveAt(0);
        }, ct);
    }

    public Task<TrayResult> RemoveFromTrayAsync(int person, string snapId, CancellationToken ct) =>
        ChangeTrayAsync(person, items => Without(items, snapId), ct);

    // A carry is one call, so when it answers the snapshot is saved, whatever any board is doing
    private async Task<TrayResult> ChangeTrayAsync(int person, Action<JsonArray> change, CancellationToken ct)
    {
        await using var trayLock = await locks.TakeAsync(AppLock.Scratchpad, person, ct);
        var tray = await store.FindTrayAsync(person, ct);
        var items = JsonNode.Parse(tray?.Items ?? "[]") as JsonArray ?? [];
        change(items);
        var json = items.ToJsonString();
        if (tray is null)
        {
            store.Add(new ScratchTray { UserId = person, Items = json, UpdatedAt = Now() });
        }
        else
        {
            tray.Items = json;
            tray.UpdatedAt = Now();
        }
        await store.SaveAsync(ct);
        return new TrayResult.Changed(items);
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

    // A name as the History tab shows it: trimmed and without control characters, or null when empty
    private static string? NameOf(string? name)
    {
        if (name is null) return null;
        var clean = new string(name.Where(c => !char.IsControl(c)).ToArray()).Trim();
        return clean.Length == 0 ? null : clean;
    }

    private static Dictionary<string, string[]> NameTooLong() =>
        new() { ["name"] = [$"A board name is at most {MaxName} characters"] };

    // Postgres keeps microseconds but .NET carries 100-nanosecond ticks, so drop the sub-microsecond part.
    // Without this the updatedAt a save answers would not equal the one a later read gives back, and the
    // guard would refuse the next save from a page that trusted the answer.
    private static DateTimeOffset Now()
    {
        var clock = DateTimeOffset.UtcNow;
        return new DateTimeOffset(clock.Ticks - clock.Ticks % TimeSpan.TicksPerMicrosecond, clock.Offset);
    }
}
