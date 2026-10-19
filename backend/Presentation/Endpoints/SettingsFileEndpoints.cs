using System.Text.Json;
using api_v2.Application.Auth;
using api_v2.Application.Settings;
using api_v2.Presentation.Contracts;
using api_v2.Application.Ports;
using api_v2.Application.Rules;

namespace api_v2.Presentation.Endpoints;

// The settings file routes. Reading the file and working out what it changes is Application/Settings/SettingsFileService.
public static class SettingsFileEndpoints
{
    // Called from MapHistory, so these live in the same group (admin only, history has to be up)
    public static void MapSettingsFile(this RouteGroupBuilder history)
    {
        // The settings as a file the team can keep or move to another copy of the app
        history.MapGet("/settings/export", (RulesService rules, SettingsService settings) =>
        {
            var file = new SettingsFile(SettingsFileService.AppName, 1, DateTimeOffset.UtcNow, settings.Retention, rules.Current.Fields.ToList());
            var bytes = JsonSerializer.SerializeToUtf8Bytes(file, new JsonSerializerOptions(RulesService.Json) { WriteIndented = true });
            return Results.File(bytes, "application/json", $"settings-{DateTime.UtcNow:yyyy-MM-dd}.json");
        });

        // What importing this file would change, nothing is saved
        history.MapPost("/settings/import/preview", async (SettingsFile? body, SettingsFileService service, CancellationToken ct) =>
            body is null ? NotOurs() : Answer(await service.PreviewAsync(Read(body), ct)));

        // Applies the file. The table is copied first, like any rules change, so it can be undone from History.
        history.MapPost("/settings/import", async (SettingsFile? body, SettingsFileService service, ICurrentUser user, CancellationToken ct) =>
            body is null ? NotOurs() : Answer(await service.ImportAsync(Read(body), user.Name, ct)));
    }

    private static SettingsImport Read(SettingsFile file) => new(file.App, file.Retention, file.Fields);

    private static IResult NotOurs() =>
        Results.BadRequest("That isn't a settings file from this app. Use a file made with Export settings");

    private static IResult Answer(SettingsImportResult result) => result switch
    {
        SettingsImportResult.Previewed plan => Results.Ok(new
        {
            plan.RulesChanged,
            plan.RetentionChanged,
            plan.Retention,
            plan.Ignored,
            plan.WillRemove
        }),
        SettingsImportResult.Imported done => Results.Ok(new { done.RulesChanged, done.RetentionChanged, done.Ignored, done.Removed }),
        SettingsImportResult.Refused refused => Results.BadRequest(refused.Message),
        SettingsImportResult.Invalid invalid => Results.ValidationProblem(invalid.Errors),
        _ => Results.Problem("Couldn't save a copy of the table first, so nothing was imported. Try again in a moment",
            statusCode: StatusCodes.Status503ServiceUnavailable, title: "Backup not available")
    };
}
