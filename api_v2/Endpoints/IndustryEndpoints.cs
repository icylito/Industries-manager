using api_v2.Data;
using api_v2.Dtos;
using api_v2.Model;
using Npgsql;

namespace api_v2.Endpoints;

public static class IndustryEndpoints
{
    public static void MapIndustries(this WebApplication app)
    {
        var group = app.MapGroup("/industries");

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
                var nameTaken = db.Industries.Any(row => row.Name == create.Name);
                if (nameTaken)
                {
                    return Results.Conflict("The name already exists in the database");
                }

                var industry = new Industry
                {
                    Name = create.Name,
                    Sector = create.Sector,
                    Price = create.Price,
                    Release = create.Release
                };
                db.Industries.Add(industry);
                db.SaveChanges();

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
                var nameTaken = db.Industries.Any(row => row.Id !=id && row.Name == update.Name);

                if (checker2 is null)
                {
                    return Results.NotFound("The row doesn't exist");
                }

                if (nameTaken)
                {
                    return Results.Conflict("The name already exist");
                }
                checker2.Name= update.Name;
                checker2.Sector= update.Sector;
                checker2.Price= update.Price;
                checker2.Release= update.Release;
                db.SaveChanges();
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
}
