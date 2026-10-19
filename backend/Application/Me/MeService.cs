using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using api_v2.Application.Ports;
using api_v2.Domain.Accounts;
using api_v2.Domain.Entities;

namespace api_v2.Application.Me;

// What the page reads back for the signed in person's settings
public record MySettingsView(JsonNode? Shortcuts, JsonNode? Mouse, string? Theme, DateTimeOffset? UpdatedAt);

public abstract record SaveSettingsResult
{
    public sealed record Saved(DateTimeOffset UpdatedAt) : SaveSettingsResult;
    public sealed record Invalid(IReadOnlyDictionary<string, string[]> Errors) : SaveSettingsResult;
    public sealed record Conflict : SaveSettingsResult;
}

// The signed in person's own keyboard and mouse settings. Nothing saved yet reads as every default.
public class MeService(IMeStore store)
{
    public async Task<MySettingsView> GetAsync(int userId, CancellationToken ct)
    {
        var mine = await store.FindAsync(userId, ct);
        return new MySettingsView(
            JsonNode.Parse(mine?.Shortcuts ?? "{}"),
            JsonNode.Parse(mine?.Mouse ?? "{}"),
            mine?.Theme,
            mine?.UpdatedAt);
    }

    // Replaces the person's settings with these. The page keeps the whole set and sends it whole.
    public async Task<SaveSettingsResult> SaveAsync(
        int userId, JsonElement? shortcutsJson, JsonElement? mouseJson, string? theme, CancellationToken ct)
    {
        var (shortcuts, keysProblem) = ShortcutRules.Shortcuts(shortcutsJson);
        var mouse = ShortcutRules.Mouse(mouseJson);
        var errors = new Dictionary<string, string[]>();
        if (shortcuts is null) errors["shortcuts"] = [keysProblem ?? "The keys could not be read"];
        if (mouse is null) errors["mouse"] = ["The mouse keys could not be read"];
        if (theme is not null && !ShortcutRules.Themes.Contains(theme)) errors["theme"] = ["Pick light or dark"];
        if (errors.Count == 0 && Encoding.UTF8.GetByteCount(shortcuts! + mouse!) > ShortcutRules.MaxBytes)
        {
            errors["shortcuts"] = ["Too many keys to save"];
        }
        if (errors.Count > 0)
        {
            return new SaveSettingsResult.Invalid(errors);
        }

        var mine = await store.FindAsync(userId, ct);
        if (mine is null)
        {
            mine = new UserSettings { UserId = userId, Shortcuts = shortcuts!, Mouse = mouse! };
            store.Add(mine);
        }
        mine.Shortcuts = shortcuts!;
        mine.Mouse = mouse!;
        mine.Theme = theme;
        mine.UpdatedAt = DateTimeOffset.UtcNow;
        if (!await store.SaveAsync(ct))
        {
            return new SaveSettingsResult.Conflict();
        }
        return new SaveSettingsResult.Saved(mine.UpdatedAt);
    }
}
