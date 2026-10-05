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

            group.MapGet("/", (AppDbContext db) =>
            {
                var result = db.Industries.Select(industry => new IndustryDto(
                    industry.Id,
                    industry.Name,
                    industry.Sector,
                    industry.Price,
                    industry.Release
                )).ToList();
                return Results.Ok(result);
            });

            // Get with Id 

            group.MapGet("/{id}", (int id, AppDbContext db) =>
            {
                var checker = db.Industries.Find(id);

                if (checker is null)
                {
                    return Results.NotFound("There is no row with that id");
                }
                return Results.Ok(new IndustryDto(
                    checker.Id,
                    checker.Name,
                    checker.Sector,
                    checker.Price,
                    checker.Release
                ));
            });

            // Post basically adding functions to the table

            group.MapPost("/", async (CreateIndustry create, AppDbContext db, RulesService rules,
                CollectorStore collector, ICurrentUser user, ILogger<Industry> log) =>
            {
                var errors = rules.Validate(Values(create.Name, create.Sector, create.Price, create.Release));
                if (errors.Count > 0)
                {
                    return Results.ValidationProblem(errors);
                }

                var name = create.Name.Trim();
                if (NameTaken(db, name))
                {
                    return Results.Conflict("The name already exists in the database");
                }

                var industry = new Industry
                {
                    Name = name,
                    Sector = create.Sector?.Trim(),
                    Price = create.Price,
                    Release = create.Release
                };
                db.Industries.Add(industry);
                if (!TrySave(db))
                {
                    return Results.Conflict("The name already exists in the database");
                }

                // Nothing old can get lost on an add, so the log comes after and a failed log only warns
                try
                {
                    await collector.LogChangeAsync(industry.Id, "add", null, Snapshot(industry),
                        rules.Current.Version, user.Name, status: "done");
                }
                catch (Exception ex)
                {
                    log.LogWarning(ex, "Row {Id} was added but the collector log failed", industry.Id);
                }

                return Results.Created($"/industries/{industry.Id}", new IndustryDto(
                    industry.Id,
                    industry.Name,
                    industry.Sector,
                    industry.Price,
                    industry.Release));
            });

            // Put or update the available tables
            group.MapPut("/update/{id}", async (int id, UpdateIndustry update, AppDbContext db, RulesService rules,
                CollectorStore collector, ICurrentUser user) =>
            {
                var checker2 = db.Industries.Find(id);

                if (checker2 is null)
                {
                    return Results.NotFound("The row doesn't exist");
                }

                var errors = rules.Validate(Values(update.Name, update.Sector, update.Price, update.Release));
                if (errors.Count > 0)
                {
                    return Results.ValidationProblem(errors);
                }

                var name = update.Name.Trim();
                if (NameTaken(db, name, id))
                {
                    return Results.Conflict("The name already exist");
                }

                // Copy the old values to the collector before touching the row
                var before = Snapshot(checker2);
                checker2.Name= name;
                // The new name is free, so a flagged import row stops being a duplicate
                checker2.DuplicateOf= null;
                checker2.Sector= update.Sector?.Trim();
                checker2.Price= update.Price;
                checker2.Release= update.Release;

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

                var saved = TrySave(db);
                await collector.FinishChangeAsync(changeId, saved);
                if (!saved)
                {
                    return Results.Conflict("The name already exist");
                }
                return Results.NoContent();
            });

            // Detele 
            group.MapDelete("/{id}", async (int id, AppDbContext db, RulesService rules,
                CollectorStore collector, ICurrentUser user) =>
            {
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
                catch
                {
                    await collector.FinishChangeAsync(changeId, done: false);
                    throw;
                }
                await collector.FinishChangeAsync(changeId, done: true);
                return Results.Content("The row has been deleted");
            });
            
    }

    private static Dictionary<string, object?> Values(string? name, string? sector, decimal? price, DateOnly? release) => new()
    {
        ["name"] = name,
        ["sector"] = sector,
        ["price"] = price,
        ["release"] = release
    };

    // Same column names as the table, so logged rows look like the rows in a saved version
    private static object Snapshot(Industry i) => new { i.Id, i.Name, i.Sector, i.Price, i.Release, i.DuplicateOf };

    private static IResult CopyFailed() => Results.Problem(
        "Couldn't save a copy of the row first, so nothing was changed. Try again in a moment",
        statusCode: StatusCodes.Status503ServiceUnavailable, title: "Backup not available");

    // Names match no matter the capitals or outside spaces, so "Atlas Steel" and "atlas steel " are the same company
    private static bool NameTaken(AppDbContext db, string name, int? exceptId = null)
    {
        var key = name.ToLower();
        return db.Industries.Any(row => row.Id != exceptId && row.Name.Trim().ToLower() == key);
    }

    // The unique index catches 2 saves of the same name at the same moment, which the check above can miss
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
