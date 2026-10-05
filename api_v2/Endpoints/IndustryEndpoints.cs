using api_v2.Data;
using api_v2.Dtos;
using api_v2.Model;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace api_v2.Endpoints;

public static class IndustryEndpoints
{
    public static void MapIndustries(this WebApplication app)
    {
        // While migrations run or after they fail, answer 503 instead of hitting a half ready database
        var group = app.MapGroup("/industries").AddEndpointFilter(async (context, next) =>
        {
            var status = context.HttpContext.RequestServices.GetRequiredService<DatabaseStatus>();
            if (status.State != DatabaseState.Ready)
            {
                return Results.Problem(status.Message, statusCode: StatusCodes.Status503ServiceUnavailable,
                    title: "Database not ready");
            }
            return await next(context);
        });

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

            group.MapPost("/", (CreateIndustry create, AppDbContext db) =>
            {
                var name = create.Name.Trim();
                if (NameTaken(db, name))
                {
                    return Results.Conflict("The name already exists in the database");
                }

                var industry = new Industry
                {
                    Name = name,
                    Sector = create.Sector,
                    Price = create.Price,
                    Release = create.Release
                };
                db.Industries.Add(industry);
                if (!TrySave(db))
                {
                    return Results.Conflict("The name already exists in the database");
                }

                return Results.Created($"/industries/{industry.Id}", new IndustryDto(
                    industry.Id,
                    industry.Name,
                    industry.Sector,
                    industry.Price,
                    industry.Release));
            });

            // Put or update the available tables
            group.MapPut("/update/{id}", (int id, UpdateIndustry update, AppDbContext db) =>
            {
                var checker2 = db.Industries.Find(id);
                var name = update.Name.Trim();

                if (checker2 is null)
                {
                    return Results.NotFound("The row doesn't exist");
                }

                if (NameTaken(db, name, id))
                {
                    return Results.Conflict("The name already exist");
                }
                checker2.Name= name;
                // The new name is free, so a flagged import row stops being a duplicate
                checker2.DuplicateOf= null;
                checker2.Sector= update.Sector;
                checker2.Price= update.Price;
                checker2.Release= update.Release;
                if (!TrySave(db))
                {
                    return Results.Conflict("The name already exist");
                }
                return Results.NoContent();
            });

            // Detele 
            group.MapDelete("/{id}", (int id, AppDbContext db) =>
            {
                var checker3 = db.Industries.Find(id);
                if (checker3 is null)
                    {
                        return Results.NotFound("The row doesn't exist");
                    }
                db.Industries.Remove(checker3);
                db.SaveChanges();
                return Results.Content("The row has been deleted");
            });
            
    }

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
