using System.Text.Json;
using api_v2.Application.Auth;
using api_v2.Application.Industries;
using api_v2.Domain.Entities;
using api_v2.Presentation.Contracts;

namespace api_v2.Presentation.Endpoints;

// The Industries routes. Every endpoint binds its input, calls one use case in Application/Industries and
// turns the answer into an HTTP result; the queries and the rules live behind that service.
public static class IndustryEndpoints
{
    private const string NameTakenMessage = "The name already exists in the database";

    public static void MapIndustries(this WebApplication app)
    {
        var group = app.MapGroup("/industries").RequireDatabaseReady();

        group.MapGet("/", async (IndustryService industries, CancellationToken ct) =>
            Results.Ok((await industries.AllAsync(ct)).Select(ToDto))).RequireViewer();

        // Rows added or edited by hand in the last 30 days, for the New and Updated tags. Never blocks the table:
        // when History is down this answers an empty list.
        group.MapGet("/activity", async (IndustryService industries, CancellationToken ct) =>
            Results.Ok((await industries.ActivityAsync(ct)).Select(r => new { r.RowId, r.Added, r.Edited }))).RequireViewer();

        // The Scratchpad rail searches by name so it never pulls the whole table down.
        group.MapGet("/search", async (string? q, string? limit, IndustryService industries, CancellationToken ct) =>
            Results.Ok((await industries.SearchAsync(q, limit, ct)).Select(ToDto))).RequireViewer();

        // The Scratchpad rail's short list: the few most expensive rows, so it never pulls the table down.
        group.MapGet("/top", async (string? limit, IndustryService industries, CancellationToken ct) =>
            Results.Ok((await industries.TopAsync(limit, ct)).Select(ToDto))).RequireViewer();

        // The Scratchpad refreshes a handful of cards without pulling the table: it sends the ids it holds.
        group.MapGet("/by-ids", async (string? ids, IndustryService industries, CancellationToken ct) =>
            Results.Ok((await industries.ByIdsAsync(ids, ct)).Select(ToDto))).RequireViewer();

        group.MapGet("/{id}", async (int id, IndustryService industries, CancellationToken ct) =>
        {
            var row = await industries.FindAsync(id, ct);
            return row is null
                ? Results.NotFound("There is no row with that id")
                : Results.Ok(ToDto(row));
        }).RequireViewer();

        group.MapPost("/", async (CreateIndustry create, IndustryService industries, ICurrentUser user, CancellationToken ct) =>
        {
            var result = await industries.AddAsync(
                new NewRow(create.Name, create.Sector, create.Price, create.Release, create.Extra), user.Name, ct);
            return result switch
            {
                AddIndustryResult.Added added => Results.Created($"/industries/{added.Row.Id}", ToDto(added.Row)),
                AddIndustryResult.Invalid invalid => Results.ValidationProblem(invalid.Errors),
                AddIndustryResult.NameTaken => Results.Conflict(NameTakenMessage),
                _ => Results.Problem(
                    "History isn't available right now, so the row wasn't added. Try again in a moment",
                    statusCode: StatusCodes.Status503ServiceUnavailable, title: "Backup not available")
            };
        }).RequireSignIn();

        group.MapPut("/update/{id}", async (int id, UpdateIndustry update, IndustryService industries, ICurrentUser user, CancellationToken ct) =>
        {
            var seen = update.Original is null
                ? null
                : new RowSeen(update.Original.Name, update.Original.Sector, update.Original.Price,
                    update.Original.Release, update.Original.Extra);
            var result = await industries.UpdateAsync(id,
                new RowEdit(update.Name, update.Sector, update.Price, update.Release, update.Extra, seen), user.Name, ct);
            return result switch
            {
                UpdateIndustryResult.Updated => Results.NoContent(),
                UpdateIndustryResult.NotFound => Results.NotFound("The row doesn't exist"),
                UpdateIndustryResult.Invalid invalid => Results.ValidationProblem(invalid.Errors),
                UpdateIndustryResult.ChangedMeanwhile => Results.Conflict(IndustryService.ChangedMeanwhileMessage),
                UpdateIndustryResult.NameTaken => Results.Conflict(NameTakenMessage),
                _ => CopyFailed()
            };
        }).RequireSignIn();

        group.MapDelete("/{id}", async (int id, IndustryService industries, ICurrentUser user, CancellationToken ct) =>
        {
            var result = await industries.DeleteAsync(id, user.Name, ct);
            return result switch
            {
                // The page says what went and from where, so a delete is never silent
                DeleteIndustryResult.Deleted deleted => Results.Ok(new { Deleted = 1, Table = "Industries", Id = id, deleted.Row.Name }),
                DeleteIndustryResult.NotFound => Results.NotFound("The row doesn't exist"),
                _ => CopyFailed()
            };
        }).RequireSignIn();
    }

    public static IndustryDto ToDto(Industry i) => new(i.Id, i.Name, i.Sector, i.Price, i.Release,
        i.DuplicateOf, i.ImportedFrom, i.LostFields, i.Extra is null ? null : JsonDocument.Parse(i.Extra).RootElement.Clone());

    private static IResult CopyFailed() => Results.Problem(
        "Couldn't save a copy of the row first, so nothing was changed. Try again in a moment",
        statusCode: StatusCodes.Status503ServiceUnavailable, title: "Backup not available");
}
