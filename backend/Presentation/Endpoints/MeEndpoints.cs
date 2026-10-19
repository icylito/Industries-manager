using api_v2.Application.Auth;
using api_v2.Application.Me;
using api_v2.Presentation.Contracts;

using api_v2.Presentation.Authorization;
using api_v2.Application.Ports;

namespace api_v2.Presentation.Endpoints;

// The signed in person's own things. Only ever their own: there is no id in these addresses.
public static class MeEndpoints
{
    public static void MapMe(this WebApplication app)
    {
        var group = app.MapGroup("/me").RequireDatabaseReady().RequireSignIn();
        // The name and picture on the profile card, see ProfileEndpoints.cs
        group.MapProfile();

        // Nothing saved yet reads as every default and the computer's own light or dark
        group.MapGet("/settings", async (MeService settings, ICurrentUser user, CancellationToken ct) =>
        {
            var mine = await settings.GetAsync(user.Id!.Value, ct);
            return Results.Ok(new
            {
                shortcuts = mine.Shortcuts,
                mouse = mine.Mouse,
                theme = mine.Theme,
                updatedAt = mine.UpdatedAt,
            });
        });

        // Replaces the person's settings with these. The page keeps the whole set and sends it whole.
        group.MapPut("/settings", async (MySettings body, MeService settings, ICurrentUser user, CancellationToken ct) =>
        {
            var result = await settings.SaveAsync(user.Id!.Value, body.Shortcuts, body.Mouse, body.Theme, ct);
            return result switch
            {
                SaveSettingsResult.Saved saved => Results.Ok(new { updatedAt = saved.UpdatedAt }),
                SaveSettingsResult.Invalid invalid => Results.ValidationProblem(invalid.Errors),
                _ => Results.Problem("Your settings were saved from another tab at the same moment. Try again",
                    statusCode: StatusCodes.Status409Conflict, title: "Changed meanwhile")
            };
        });
    }
}
