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
using api_v2.Presentation.Contracts;
using api_v2.Domain.Entities;
using api_v2.Domain.Rules;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace api_v2.Presentation.Endpoints;

public static class IndustryEndpoints
{
    // How many rows the Scratchpad rail asks for, and the most one search may return
    private const int SearchDefaultLimit = 10;
    private const int SearchMaxLimit = 25;
    // How many rows the Scratchpad rail's top list asks for: the three most expensive by default
    private const int TopDefaultLimit = 3;
    private const int TopMaxLimit = 25;
    // The most rows one cards refresh may ask for: the board itself holds at most 500 things
    private const int ByIdsMax = 500;

    public static void MapIndustries(this WebApplication app)
    {
        var group = app.MapGroup("/industries").RequireDatabaseReady();

            group.MapGet("/", async (AppDbContext db) =>
            {
                var rows = await db.Industries.AsNoTracking().OrderBy(i => i.Id).ToListAsync();
                return Results.Ok(rows.Select(ToDto));
            }).RequireViewer();

            // Rows added or edited by hand in the last 30 days, for the New and Updated tags. Never blocks the table:
            // when History is down this answers an empty list.
            group.MapGet("/activity", async (CollectorStore collector, CancellationToken ct) =>
            {
                try
                {
                    var rows = await collector.RecentActivityAsync(30, ct);
                    return Results.Ok(rows.Select(r => new { r.RowId, r.Added, r.Edited }));
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    collector.NoteFailure(ex);
                    return Results.Ok(Array.Empty<object>());
                }
            }).RequireViewer();

            // The Scratchpad rail searches by name so it never pulls the whole table down.
            // A blank search answers an empty list, the same as never looking.
            group.MapGet("/search", async (string? q, string? limit, AppDbContext db, CancellationToken ct) =>
            {
                var needle = q?.Trim() ?? "";
                if (needle.Length == 0) return Results.Ok(Array.Empty<IndustryDto>());

                // A limit that isn't a number falls back to the default instead of failing the call
                var take = SearchDefaultLimit;
                if (int.TryParse(limit, out var asked)) take = Math.Clamp(asked, 1, SearchMaxLimit);

                // The same comparison the unique name rule uses: lower(btrim(Name)) in Postgres, never C#.
                // position() keeps the needle a plain substring, so a % or _ in it can't act as a wildcard.
                var rows = await db.Industries.FromSql($"""
                    SELECT * FROM "Industries"
                    WHERE position(lower(btrim({needle})) in lower(btrim("Name"))) > 0
                    ORDER BY lower(btrim("Name")), "Id"
                    LIMIT {take}
                    """).AsNoTracking().ToListAsync(ct);
                return Results.Ok(rows.Select(ToDto));
            }).RequireViewer();

            // The Scratchpad rail's short list: the few most expensive rows, so it never pulls the table down.
            // Only by=price is offered today. A by anywhere else, or none at all, is answered with price
            // rather than a failure, so a typo in the rail can never break the list.
            group.MapGet("/top", async (string? limit, AppDbContext db, CancellationToken ct) =>
            {
                // A limit that isn't a number, or is out of range, falls back or clamps instead of failing
                var take = TopDefaultLimit;
                if (int.TryParse(limit, out var asked)) take = Math.Clamp(asked, 1, TopMaxLimit);

                // Rows with no price are skipped. Highest first, ties by lower(btrim(Name)) then Id, the same
                // comparison the search endpoint and the unique name rule use.
                var rows = await db.Industries.FromSql($"""
                    SELECT * FROM "Industries"
                    WHERE "Price" IS NOT NULL
                    ORDER BY "Price" DESC, lower(btrim("Name")), "Id"
                    LIMIT {take}
                    """).AsNoTracking().ToListAsync(ct);
                return Results.Ok(rows.Select(ToDto));
            }).RequireViewer();

            // The Scratchpad refreshes a handful of cards without pulling the table: it sends the ids it holds.
            // Anything non-numeric is ignored, at most 500 ids are looked at, and no valid id answers an empty
            // list rather than a failure, so junk input can never break the call.
            group.MapGet("/by-ids", async (string? ids, AppDbContext db, CancellationToken ct) =>
            {
                var wanted = new List<int>();
                foreach (var part in (ids ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
                {
                    if (wanted.Count >= ByIdsMax) break;
                    if (int.TryParse(part, out var id)) wanted.Add(id);
                }
                if (wanted.Count == 0) return Results.Ok(Array.Empty<IndustryDto>());

                var rows = await db.Industries.AsNoTracking()
                    .Where(i => wanted.Contains(i.Id))
                    .OrderBy(i => i.Id)
                    .ToListAsync(ct);
                return Results.Ok(rows.Select(ToDto));
            }).RequireViewer();

            // Get with Id

            group.MapGet("/{id}", (int id, AppDbContext db) =>
            {
                var checker = db.Industries.Find(id);

                if (checker is null)
                {
                    return Results.NotFound("There is no row with that id");
                }
                return Results.Ok(ToDto(checker));
            }).RequireViewer();

            // Post basically adding functions to the table

            group.MapPost("/", async (CreateIndustry create, AppDbContext db, RulesService rules,
                CollectorStore collector, ICurrentUser user, AppLocks locks, CancellationToken ct) =>
            {
                await using var tableLock = await locks.TakeAsync(AppLock.Table, ct);
                var input = rules.Read(create.Name, create.Sector, create.Price, create.Release, create.Extra, currentSector: null);
                if (input.Errors.Count > 0)
                {
                    return Results.ValidationProblem(input.Errors);
                }

                var name = input.Values["name"] as string ?? "";
                if (Names.HasNoLetters(name))
                {
                    return Results.ValidationProblem(new Dictionary<string, string[]> { ["name"] = [Names.NoKeyMessage] });
                }
                if (await Names.TakenAsync(db, name, null, ct))
                {
                    return Results.Conflict("The name already exists in the database");
                }

                var industry = new Industry
                {
                    Name = name,
                    Sector = input.Values["sector"] as string,
                    Price = create.Price,
                    Release = create.Release,
                    Extra = MergeExtra(null, input.Custom)
                };
                db.Industries.Add(industry);

                // Log first, same as an edit. If history is down the row is not added.
                long changeId;
                try
                {
                    changeId = await collector.LogChangeAsync(null, "add", null, Snapshot(industry),
                        rules.Current.Version, user.Name);
                }
                catch (Exception ex)
                {
                    collector.NoteFailure(ex);
                    return Results.Problem(
                        "History isn't available right now, so the row wasn't added. Try again in a moment",
                        statusCode: StatusCodes.Status503ServiceUnavailable, title: "Backup not available");
                }

                bool saved;
                try
                {
                    saved = TrySave(db);
                }
                catch
                {
                    await collector.FinishChangeAsync(changeId, false);
                    throw;
                }
                if (!saved)
                {
                    await collector.FinishChangeAsync(changeId, false);
                    return Results.Conflict("The name already exists in the database");
                }
                await collector.FinishChangeAsync(changeId, true, rowId: industry.Id, after: Snapshot(industry));
                return Results.Created($"/industries/{industry.Id}", ToDto(industry));
            }).RequireSignIn();

            // Put or update the available tables
            group.MapPut("/update/{id}", async (int id, UpdateIndustry update, AppDbContext db, RulesService rules,
                CollectorStore collector, ICurrentUser user, AppLocks locks, CancellationToken ct) =>
            {
                await using var tableLock = await locks.TakeAsync(AppLock.Table, ct);
                var checker2 = db.Industries.Find(id);

                if (checker2 is null)
                {
                    return Results.NotFound("The row doesn't exist");
                }

                // Checked under the table lock, so nothing can change the row between this check and the save
                if (update.Original is { } seen && !SameAs(checker2, seen))
                {
                    return Results.Conflict(ChangedMeanwhileMessage);
                }

                var input = rules.Read(update.Name, update.Sector, update.Price, update.Release, update.Extra, checker2.Sector, checker2.Extra);
                if (input.Errors.Count > 0)
                {
                    return Results.ValidationProblem(input.Errors);
                }

                var name = input.Values["name"] as string ?? "";
                if (Names.HasNoLetters(name))
                {
                    return Results.ValidationProblem(new Dictionary<string, string[]> { ["name"] = [Names.NoKeyMessage] });
                }
                var renamed = !Names.Same(name, checker2.Name);
                // A flagged import row keeps its name and its flag while the rest of it gets fixed
                var staysDuplicate = checker2.DuplicateOf is not null && !renamed;
                if (!staysDuplicate && await Names.TakenAsync(db, name, id, ct))
                {
                    return Results.Conflict("The name already exists in the database");
                }

                // Copy the old values to the collector before touching the row
                var before = Snapshot(checker2);
                checker2.Name= name;
                // The new name is free, so a flagged import row stops being a duplicate
                if (!staysDuplicate) checker2.DuplicateOf= null;
                checker2.Sector= input.Values["sector"] as string;
                checker2.Price= update.Price;
                checker2.Release= update.Release;
                checker2.Extra= MergeExtra(checker2.Extra, input.Custom);
                // Saving the row means someone looked at it, the red "couldn't be brought over" triangle goes away
                checker2.LostFields= null;

                long changeId;
                try
                {
                    changeId = await collector.LogChangeAsync(id, "edit", before, Snapshot(checker2),
                        rules.Current.Version, user.Name);
                }
                catch (Exception ex)
                {
                    collector.NoteFailure(ex);
                    return CopyFailed();
                }

                bool saved;
                try
                {
                    saved = TrySave(db);
                }
                catch
                {
                    await collector.FinishChangeAsync(changeId, false);
                    throw;
                }
                await collector.FinishChangeAsync(changeId, saved);
                if (!saved)
                {
                    return Results.Conflict("The name already exists in the database");
                }
                if (renamed)
                {
                    await ResolveDuplicatesAsync(db, id, collector, rules, user);
                }
                return Results.NoContent();
            }).RequireSignIn();

            // Detele
            group.MapDelete("/{id}", async (int id, AppDbContext db, RulesService rules,
                CollectorStore collector, ICurrentUser user, AppLocks locks, CancellationToken ct) =>
            {
                await using var tableLock = await locks.TakeAsync(AppLock.Table, ct);
                var checker3 = db.Industries.Find(id);
                if (checker3 is null)
                    {
                        return Results.NotFound("The row doesn't exist");
                    }

                // The row only gets deleted once its copy is in the collector
                long changeId;
                try
                {
                    changeId = await collector.LogChangeAsync(id, "delete", Snapshot(checker3), null,
                        rules.Current.Version, user.Name);
                }
                catch (Exception ex)
                {
                    collector.NoteFailure(ex);
                    return CopyFailed();
                }

                db.Industries.Remove(checker3);
                try
                {
                    db.SaveChanges();
                }
                catch (DbUpdateConcurrencyException)
                {
                    await collector.FinishChangeAsync(changeId, done: false);
                    return Results.NotFound("The row doesn't exist");
                }
                catch
                {
                    await collector.FinishChangeAsync(changeId, done: false);
                    throw;
                }
                await collector.FinishChangeAsync(changeId, done: true);
                await ResolveDuplicatesAsync(db, id, collector, rules, user);
                // The page says what went and from where, so a delete is never silent
                return Results.Ok(new { Deleted = 1, Table = "Industries", Id = id, checker3.Name });
            }).RequireSignIn();

    }

    public const string ChangedMeanwhileMessage =
        "Someone changed this row since you opened it. Load their version, then make your change again";

    // The row still holds what the page showed. Extra is compared as JSON, so key order and 1 against 1.0 don't count
    // as a change, and no custom values at all is the same as an empty set of them.
    private static bool SameAs(Industry row, IndustryOriginal seen)
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

    public static IndustryDto ToDto(Industry i) => new(i.Id, i.Name, i.Sector, i.Price, i.Release,
        i.DuplicateOf, i.ImportedFrom, i.LostFields, i.Extra is null ? null : JsonDocument.Parse(i.Extra).RootElement.Clone());

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

    private static IResult CopyFailed() => Results.Problem(
        "Couldn't save a copy of the row first, so nothing was changed. Try again in a moment",
        statusCode: StatusCodes.Status503ServiceUnavailable, title: "Backup not available");

    // When a row that imported rows were flagged against gets renamed or deleted, the oldest of those
    // rows takes its place and the others point at it, so the similar row flags stay right
    private static async Task ResolveDuplicatesAsync(AppDbContext db, int ownerId, CollectorStore collector,
        RulesService rules, ICurrentUser user)
    {
        var flagged = await db.Industries.Where(r => r.DuplicateOf == ownerId).OrderBy(r => r.Id).ToListAsync();
        if (flagged.Count == 0) return;

        var name = flagged[0].Name;
        var flaggedIds = flagged.Select(f => f.Id).ToArray();
        var found = await db.Database.SqlQuery<int>($"""
            SELECT "Id" AS "Value" FROM "Industries"
            WHERE "DuplicateOf" IS NULL AND "Name" COLLATE name_rule = {name} AND "Id" <> ALL({flaggedIds})
            ORDER BY "Id" LIMIT 1
            """).ToListAsync();
        int? newOwner = found.Count == 0 ? null : found[0];

        foreach (var row in flagged)
        {
            row.DuplicateOf = newOwner;
        }
        if (newOwner is null)
        {
            flagged[0].DuplicateOf = null;
            foreach (var row in flagged.Skip(1)) row.DuplicateOf = flagged[0].Id;
        }
        if (!TrySave(db)) return;

        // The flags moved by themselves, so the log gets one entry per row that now points somewhere else
        foreach (var row in flagged)
        {
            try
            {
                await collector.LogChangeAsync(row.Id, "flag-move", new { row.Id, DuplicateOf = (int?)ownerId },
                    new { row.Id, row.DuplicateOf }, rules.Current.Version, user.Name, "done");
            }
            catch (Exception)
            {
                // The flags already moved, a missing log line isn't worth failing the delete or rename
            }
        }
    }

    // The unique index catches 2 saves of the same name at the same moment, which the check above can miss.
    // Any other save error is thrown so the caller can mark the change failed.
    private static bool TrySave(AppDbContext db)
    {
        try
        {
            db.SaveChanges();
            return true;
        }
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            db.ChangeTracker.Clear();
            return false;
        }
    }
}
