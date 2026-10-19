using System.Text.Json;
using System.Text.Json.Nodes;
using api_v2.Application.Exceptions;
using api_v2.Application.Ports;
using api_v2.Domain.Entities;
using api_v2.Domain.Rules;
using api_v2.Application.Rules;

namespace api_v2.Application.Industries;

// The Industries table: reading it for the page and the Scratchpad rail, and the add, edit and delete use cases.
// The steps run in the order the page needs them: take the table lock, check the row against the rules, log the
// change in the collector, save, and only then mark the log entry done.
public class IndustryService(IIndustryStore store, ICollectorStore collector, IAppLocks locks, INameIndex names, RulesService rules)
{
    public const string ChangedMeanwhileMessage =
        "Someone changed this row since you opened it. Load their version, then make your change again";

    // How many rows the Scratchpad rail asks for, and the most one search may return
    private const int SearchDefaultLimit = 10;
    private const int SearchMaxLimit = 25;

    // How many rows the Scratchpad rail's top list asks for: the three most expensive by default
    private const int TopDefaultLimit = 3;
    private const int TopMaxLimit = 25;

    // The most rows one cards refresh may ask for: the board itself holds at most 500 things
    private const int ByIdsMax = 500;

    public Task<IReadOnlyList<Industry>> AllAsync(CancellationToken ct) => store.AllAsync(ct);

    // Rows added or edited by hand in the last 30 days, for the New and Updated tags. Never blocks the table:
    // when History is down this answers an empty list.
    public async Task<IReadOnlyList<ActivityRow>> ActivityAsync(CancellationToken ct)
    {
        try
        {
            return await collector.RecentActivityAsync(30, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            collector.NoteFailure(ex);
            return [];
        }
    }

    // The Scratchpad rail searches by name so it never pulls the whole table down.
    // A blank search answers an empty list, the same as never looking.
    public Task<IReadOnlyList<Industry>> SearchAsync(string? q, string? limit, CancellationToken ct)
    {
        var needle = q?.Trim() ?? "";
        if (needle.Length == 0) return Task.FromResult<IReadOnlyList<Industry>>([]);

        // A limit that isn't a number falls back to the default instead of failing the call
        var take = SearchDefaultLimit;
        if (int.TryParse(limit, out var asked)) take = Math.Clamp(asked, 1, SearchMaxLimit);
        return store.SearchAsync(needle, take, ct);
    }

    // The Scratchpad rail's short list: the few most expensive rows, so it never pulls the table down.
    // A limit that isn't a number, or is out of range, falls back or clamps instead of failing.
    public Task<IReadOnlyList<Industry>> TopAsync(string? limit, CancellationToken ct)
    {
        var take = TopDefaultLimit;
        if (int.TryParse(limit, out var asked)) take = Math.Clamp(asked, 1, TopMaxLimit);
        return store.TopByPriceAsync(take, ct);
    }

    // The Scratchpad refreshes a handful of cards without pulling the table: it sends the ids it holds.
    // Anything non-numeric is ignored, at most 500 ids are looked at, and no valid id answers an empty list.
    public Task<IReadOnlyList<Industry>> ByIdsAsync(string? ids, CancellationToken ct)
    {
        var wanted = new List<int>();
        foreach (var part in (ids ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (wanted.Count >= ByIdsMax) break;
            if (int.TryParse(part, out var id)) wanted.Add(id);
        }
        return wanted.Count == 0 ? Task.FromResult<IReadOnlyList<Industry>>([]) : store.ByIdsAsync(wanted, ct);
    }

    public Task<Industry?> FindAsync(int id, CancellationToken ct) => store.FindAsync(id, ct);

    public async Task<AddIndustryResult> AddAsync(NewRow create, string changedBy, CancellationToken ct)
    {
        await using var tableLock = await locks.TakeAsync(AppLock.Table, ct);

        var input = rules.Read(create.Name, create.Sector, create.Price, create.Release, create.Extra, currentSector: null);
        if (input.Errors.Count > 0)
        {
            return new AddIndustryResult.Invalid(input.Errors);
        }

        var name = input.Values["name"] as string ?? "";
        if (Names.HasNoLetters(name))
        {
            return new AddIndustryResult.Invalid(new Dictionary<string, string[]> { ["name"] = [Names.NoKeyMessage] });
        }
        if (await names.TakenAsync(name, null, ct))
        {
            return new AddIndustryResult.NameTaken();
        }

        var industry = new Industry
        {
            Name = name,
            Sector = input.Values["sector"] as string,
            Price = create.Price,
            Release = create.Release,
            Extra = MergeExtra(null, input.Custom)
        };
        store.Add(industry);

        // Log first, same as an edit. If history is down the row is not added.
        long changeId;
        try
        {
            changeId = await collector.LogChangeAsync(null, "add", null, Snapshot(industry),
                rules.Current.Version, changedBy);
        }
        catch (Exception ex)
        {
            collector.NoteFailure(ex);
            return new AddIndustryResult.HistoryDown();
        }

        bool saved;
        try
        {
            saved = await store.SaveAsync(ct);
        }
        catch
        {
            await collector.FinishChangeAsync(changeId, false);
            throw;
        }
        if (!saved)
        {
            await collector.FinishChangeAsync(changeId, false);
            return new AddIndustryResult.NameTaken();
        }
        await collector.FinishChangeAsync(changeId, true, rowId: industry.Id, after: Snapshot(industry));
        return new AddIndustryResult.Added(industry);
    }

    public async Task<UpdateIndustryResult> UpdateAsync(int id, RowEdit update, string changedBy, CancellationToken ct)
    {
        await using var tableLock = await locks.TakeAsync(AppLock.Table, ct);
        var row = await store.FindAsync(id, ct);
        if (row is null)
        {
            return new UpdateIndustryResult.NotFound();
        }

        // Checked under the table lock, so nothing can change the row between this check and the save
        if (update.Original is { } seen && !SameAs(row, seen))
        {
            return new UpdateIndustryResult.ChangedMeanwhile();
        }

        var input = rules.Read(update.Name, update.Sector, update.Price, update.Release, update.Extra, row.Sector, row.Extra);
        if (input.Errors.Count > 0)
        {
            return new UpdateIndustryResult.Invalid(input.Errors);
        }

        var name = input.Values["name"] as string ?? "";
        if (Names.HasNoLetters(name))
        {
            return new UpdateIndustryResult.Invalid(new Dictionary<string, string[]> { ["name"] = [Names.NoKeyMessage] });
        }
        var renamed = !Names.Same(name, row.Name);
        // A flagged import row keeps its name and its flag while the rest of it gets fixed
        var staysDuplicate = row.DuplicateOf is not null && !renamed;
        if (!staysDuplicate && await names.TakenAsync(name, id, ct))
        {
            return new UpdateIndustryResult.NameTaken();
        }

        // Copy the old values to the collector before touching the row
        var before = Snapshot(row);
        row.Name = name;
        // The new name is free, so a flagged import row stops being a duplicate
        if (!staysDuplicate) row.DuplicateOf = null;
        row.Sector = input.Values["sector"] as string;
        row.Price = update.Price;
        row.Release = update.Release;
        row.Extra = MergeExtra(row.Extra, input.Custom);
        // Saving the row means someone looked at it, the red "couldn't be brought over" triangle goes away
        row.LostFields = null;

        long changeId;
        try
        {
            changeId = await collector.LogChangeAsync(id, "edit", before, Snapshot(row),
                rules.Current.Version, changedBy);
        }
        catch (Exception ex)
        {
            collector.NoteFailure(ex);
            return new UpdateIndustryResult.HistoryDown();
        }

        bool saved;
        try
        {
            saved = await store.SaveAsync(ct);
        }
        catch
        {
            await collector.FinishChangeAsync(changeId, false);
            throw;
        }
        await collector.FinishChangeAsync(changeId, saved);
        if (!saved)
        {
            return new UpdateIndustryResult.NameTaken();
        }
        if (renamed)
        {
            await ResolveDuplicatesAsync(id, changedBy, ct);
        }
        return new UpdateIndustryResult.Updated();
    }

    public async Task<DeleteIndustryResult> DeleteAsync(int id, string changedBy, CancellationToken ct)
    {
        await using var tableLock = await locks.TakeAsync(AppLock.Table, ct);
        var row = await store.FindAsync(id, ct);
        if (row is null)
        {
            return new DeleteIndustryResult.NotFound();
        }

        // The row only gets deleted once its copy is in the collector
        long changeId;
        try
        {
            changeId = await collector.LogChangeAsync(id, "delete", Snapshot(row), null,
                rules.Current.Version, changedBy);
        }
        catch (Exception ex)
        {
            collector.NoteFailure(ex);
            return new DeleteIndustryResult.HistoryDown();
        }

        store.Remove(row);
        try
        {
            await store.SaveAsync(ct);
        }
        catch (RowGoneException)
        {
            await collector.FinishChangeAsync(changeId, done: false);
            return new DeleteIndustryResult.NotFound();
        }
        catch
        {
            await collector.FinishChangeAsync(changeId, done: false);
            throw;
        }
        await collector.FinishChangeAsync(changeId, done: true);
        await ResolveDuplicatesAsync(id, changedBy, ct);
        return new DeleteIndustryResult.Deleted(row);
    }

    // When a row that imported rows were flagged against gets renamed or deleted, the oldest of those
    // rows takes its place and the others point at it, so the similar row flags stay right
    private async Task ResolveDuplicatesAsync(int ownerId, string changedBy, CancellationToken ct)
    {
        var flagged = await store.FlaggedAgainstAsync(ownerId, ct);
        if (flagged.Count == 0) return;

        var name = flagged[0].Name;
        var flaggedIds = flagged.Select(f => f.Id).ToArray();
        var newOwner = await store.OwnerOfNameAsync(name, flaggedIds, ct);

        foreach (var row in flagged)
        {
            row.DuplicateOf = newOwner;
        }
        if (newOwner is null)
        {
            flagged[0].DuplicateOf = null;
            foreach (var row in flagged.Skip(1)) row.DuplicateOf = flagged[0].Id;
        }
        if (!await store.SaveAsync(ct)) return;

        // The flags moved by themselves, so the log gets one entry per row that now points somewhere else
        foreach (var row in flagged)
        {
            try
            {
                await collector.LogChangeAsync(row.Id, "flag-move", new { row.Id, DuplicateOf = (int?)ownerId },
                    new { row.Id, row.DuplicateOf }, rules.Current.Version, changedBy, "done");
            }
            catch (Exception)
            {
                // The flags already moved, a missing log line isn't worth failing the delete or rename
            }
        }
    }

    // The row still holds what the page showed. Extra is compared as JSON, so key order and 1 against 1.0 don't count
    // as a change, and no custom values at all is the same as an empty set of them.
    private static bool SameAs(Industry row, RowSeen seen)
    {
        if (row.Name != seen.Name || (row.Sector ?? "") != (seen.Sector ?? "") || row.Price != seen.Price || row.Release != seen.Release)
            return false;
        var now = row.Extra is null ? new JsonObject() : JsonNode.Parse(row.Extra);
        var then = seen.Extra is { ValueKind: JsonValueKind.Object } e ? JsonNode.Parse(e.GetRawText()) : new JsonObject();
        return JsonNode.DeepEquals(WithoutNulls(now), WithoutNulls(then));
    }

    private static JsonNode? WithoutNulls(JsonNode? node)
    {
        if (node is not JsonObject obj) return node;
        foreach (var key in obj.Where(p => p.Value is null).Select(p => p.Key).ToList()) obj.Remove(key);
        return obj;
    }

    // Same column names as the table, so logged rows look like the rows in a saved version
    private static object Snapshot(Industry i) => new
    {
        i.Id, i.Name, i.Sector, i.Price, i.Release, i.DuplicateOf, i.ImportedFrom, i.LostFields,
        Extra = i.Extra is null ? (JsonElement?)null : JsonDocument.Parse(i.Extra).RootElement.Clone()
    };

    // Keeps hidden and unknown keys, so hiding a field never loses its data
    private static string? MergeExtra(string? existing, Dictionary<string, object?> custom)
    {
        var extra = existing is null ? new JsonObject() : JsonNode.Parse(existing)!.AsObject();
        foreach (var (key, value) in custom)
        {
            var stored = RulesService.ToStored(value);
            if (stored is null) extra.Remove(key);
            else extra[key] = JsonValue.Create(stored);
        }
        return extra.Count == 0 ? null : extra.ToJsonString();
    }
}
