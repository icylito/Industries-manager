using System.Text.Json;
using System.Text.Json.Nodes;
using api_v2.Auth;
using api_v2.Data;
using api_v2.Dtos;
using api_v2.Model;
using api_v2.Rules;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace api_v2.Endpoints;

public static class IndustryEndpoints
{
    public static void MapIndustries(this WebApplication app)
    {
        var group = app.MapGroup("/industries").RequireDatabaseReady();

            group.MapGet("/", async (AppDbContext db) =>
            {
                var rows = await db.Industries.AsNoTracking().OrderBy(i => i.Id).ToListAsync();
                return Results.Ok(rows.Select(ToDto));
            });

            // Get with Id

            group.MapGet("/{id}", (int id, AppDbContext db) =>
            {
                var checker = db.Industries.Find(id);

                if (checker is null)
                {
                    return Results.NotFound("There is no row with that id");
                }
                return Results.Ok(ToDto(checker));
            });

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
                catch (Exception)
                {
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
            });

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

                var input = rules.Read(update.Name, update.Sector, update.Price, update.Release, update.Extra, checker2.Sector);
                if (input.Errors.Count > 0)
                {
                    return Results.ValidationProblem(input.Errors);
                }

                var name = input.Values["name"] as string ?? "";
                var renamed = !await Names.SameAsync(db, name, checker2.Name, ct);
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
                catch (Exception)
                {
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
                    await ResolveDuplicatesAsync(db, id);
                }
                return Results.NoContent();
            });

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
                catch (Exception)
                {
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
                await ResolveDuplicatesAsync(db, id);
                return Results.Content("The row has been deleted");
            });

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
    private static async Task ResolveDuplicatesAsync(AppDbContext db, int ownerId)
    {
        var flagged = await db.Industries.Where(r => r.DuplicateOf == ownerId).OrderBy(r => r.Id).ToListAsync();
        if (flagged.Count == 0) return;

        var name = flagged[0].Name;
        var flaggedIds = flagged.Select(f => f.Id).ToArray();
        var found = await db.Database.SqlQuery<int>($"""
            SELECT "Id" AS "Value" FROM "Industries"
            WHERE "DuplicateOf" IS NULL AND lower(btrim("Name")) = lower(btrim({name})) AND "Id" <> ALL({flaggedIds})
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
        TrySave(db);
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
