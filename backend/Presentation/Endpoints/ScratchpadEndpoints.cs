using System.Text.Json;
using System.Text.Json.Nodes;
using api_v2.Application.Ports;
using api_v2.Application.Scratchpad;
using api_v2.Domain.Entities;
using api_v2.Presentation.Contracts;

using api_v2.Presentation.Authorization;

namespace api_v2.Presentation.Endpoints;

// The Scratchpad: a person's boards (each one endless canvas), their carry tray, and the files on their boards.
// Admin only for now, and every board, tray and file is the person's own: someone else's board answers 404.
// Each endpoint binds its input, calls one use case in Application/Scratchpad and turns the answer into an HTTP
// result; the checks, the order of the steps and the storage live behind that service.
public static class ScratchpadEndpoints
{
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
        group.MapGet("/boards", async (ScratchpadService pad, ICurrentUser user, CancellationToken ct) =>
            Results.Ok((await pad.BoardsAsync(user.Id!.Value, ct))
                .Select(r => new BoardSummary(r.Id, r.Name, r.Pinned, r.CreatedAt, r.UpdatedAt, r.Things))));

        group.MapPost("/boards", async (NewBoard body, ScratchpadService pad, ICurrentUser user, CancellationToken ct) =>
        {
            var result = await pad.CreateAsync(user.Id!.Value, body.Name, body.Document, ct);
            return result switch
            {
                CreateBoardResult.Created created => Results.Created($"/scratchpad/boards/{created.Board.Id}", Summary(created.Board)),
                CreateBoardResult.Invalid invalid => Results.ValidationProblem(invalid.Errors),
                _ => Results.Problem($"You can keep at most {ScratchpadService.MaxBoards} boards. Delete one you no longer need first.",
                    statusCode: StatusCodes.Status409Conflict, title: "Too many boards")
            };
        });

        group.MapGet("/boards/{id:int}", async (int id, ScratchpadService pad, ICurrentUser user, CancellationToken ct) =>
        {
            var board = await pad.GetAsync(id, user.Id!.Value, ct);
            return board is null ? BoardNotFound() : Results.Ok(board);
        });

        // Saves the whole board. The page sends this on its own after every change, so there is no Save button.
        group.MapPut("/boards/{id:int}", async (int id, BoardSave body, ScratchpadService pad, ICurrentUser user, CancellationToken ct) =>
        {
            var result = await pad.SaveAsync(id, user.Id!.Value, body.Document, body.UpdatedAt, ct);
            return result switch
            {
                SaveBoardResult.Saved saved => Results.Ok(new { updatedAt = saved.UpdatedAt }),
                SaveBoardResult.Invalid invalid => Results.ValidationProblem(invalid.Errors),
                SaveBoardResult.NotFound => BoardNotFound(),
                _ => Results.Problem(ScratchpadService.ChangedMeanwhileMessage, statusCode: StatusCodes.Status409Conflict,
                    title: "Changed meanwhile")
            };
        });

        // Rename, pin or unpin, and where the person left the board. Each touches one column and never the
        // document, so none of them makes an open tab's next save refuse.
        group.MapPatch("/boards/{id:int}", async (int id, BoardChange body, ScratchpadService pad, ICurrentUser user, CancellationToken ct) =>
        {
            var result = await pad.ChangeAsync(id, user.Id!.Value, body.Name, body.Pinned, body.View, ct);
            return result switch
            {
                ChangeBoardResult.Changed changed => Results.Ok(changed.Board),
                ChangeBoardResult.Invalid invalid => Results.ValidationProblem(invalid.Errors),
                _ => BoardNotFound()
            };
        });

        group.MapDelete("/boards/{id:int}", async (int id, ScratchpadService pad, ICurrentUser user, CancellationToken ct) =>
        {
            var result = await pad.DeleteAsync(id, user.Id!.Value, ct);
            return result switch
            {
                DeleteBoardResult.Deleted => Results.Ok(new { deleted = 1, id }),
                DeleteBoardResult.Pinned => Results.Problem("This board is pinned. Unpin it first.", statusCode: StatusCodes.Status409Conflict,
                    title: "Pinned"),
                _ => BoardNotFound()
            };
        });
    }

    // The carry tray. A carry is one call, so when it answers the snapshot is saved, whatever any board is doing.
    private static void MapTray(RouteGroupBuilder group)
    {
        group.MapGet("/tray", async (ScratchpadService pad, ICurrentUser user, CancellationToken ct) =>
            Results.Ok(new { items = await pad.TrayAsync(user.Id!.Value, ct) }));

        // Puts a snapshot in the tray, at the end. The same snapshot carried again moves to the end instead of
        // showing twice, which is how undoing "put it on the board" gives it back.
        group.MapPost("/tray", async (JsonElement body, ScratchpadService pad, ICurrentUser user, CancellationToken ct) =>
            TrayAnswer(await pad.AddToTrayAsync(user.Id!.Value, body, ct)));

        group.MapDelete("/tray/{snapId}", async (string snapId, ScratchpadService pad, ICurrentUser user, CancellationToken ct) =>
            TrayAnswer(await pad.RemoveFromTrayAsync(user.Id!.Value, snapId, ct)));
    }

    private static IResult TrayAnswer(TrayResult result) => result switch
    {
        TrayResult.Changed changed => Results.Ok(new { items = changed.Items }),
        TrayResult.Invalid invalid => Results.ValidationProblem(invalid.Errors),
        _ => Results.Problem()
    };

    private static BoardSummary Summary(ScratchBoard board) =>
        new(board.Id, board.Name, board.Pinned, board.CreatedAt, board.UpdatedAt,
            (JsonNode.Parse(board.Document)?["items"] as JsonArray)?.Count ?? 0);

    private static IResult BoardNotFound() => Results.NotFound("There is no board with that id");
}
