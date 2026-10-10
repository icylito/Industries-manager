using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using api_v2.Auth;
using api_v2.Data;
using api_v2.Model;
using Microsoft.EntityFrameworkCore;

namespace api_v2.Endpoints;

// The whole of a person's own settings, sent and saved as one
public record MySettings(JsonElement? Shortcuts, JsonElement? Mouse, string? Theme);

// The signed in person's own things. Only ever their own: there is no id in these addresses.
public static partial class MeEndpoints
{
    private const int MaxBytes = 16_000;

    // Every function the Shortcuts panel can rebind, the same ids as COMMANDS in angular/src/app/services/shortcuts.ts.
    // testing/check_scratchpad.py checks the two lists still match.
    public static readonly string[] KnownCommands =
    [
        "nav.overview", "nav.scratchpad", "nav.prev", "nav.next", "keys.open",
        "ov.slice1", "ov.slice2", "ov.slice3", "ov.slice4", "ov.slice5", "ov.find", "ov.compare", "ov.metric", "ov.top", "ov.clear",
        "sp.select", "sp.hand", "sp.line", "sp.pen", "sp.marker", "sp.rect", "sp.sticky", "sp.text", "sp.undo", "sp.redo",
        "sp.zoom100", "sp.fit", "sp.zoomSel", "sp.clear", "sp.group", "sp.ungroup", "sp.duplicate", "sp.selectAll",
        "sp.back", "sp.front",
    ];

    // The Mouse rows whose held key can change, with the key each holds until changed (MOUSE_ROWS in shortcuts.ts)
    private static readonly Dictionary<string, string> MouseDefaults = new()
    {
        ["mouse.add"] = "Shift",
        ["mouse.zoom"] = "Ctrl",
        ["mouse.dup"] = "Alt",
    };
    public static IEnumerable<string> KnownMouseRows => MouseDefaults.Keys;
    private static readonly string[] MouseKeys = ["Shift", "Ctrl", "Alt"];
    private static readonly string[] Themes = ["light", "dark"];

    public static void MapMe(this WebApplication app)
    {
        var group = app.MapGroup("/me").RequireDatabaseReady().RequireSignIn();

        // Nothing saved yet reads as every default and the computer's own light or dark
        group.MapGet("/settings", async (AppDbContext db, ICurrentUser user, CancellationToken ct) =>
        {
            var mine = await db.UserSettings.AsNoTracking().FirstOrDefaultAsync(s => s.UserId == user.Id, ct);
            return Results.Ok(new
            {
                shortcuts = JsonNode.Parse(mine?.Shortcuts ?? "{}"),
                mouse = JsonNode.Parse(mine?.Mouse ?? "{}"),
                theme = mine?.Theme,
                updatedAt = mine?.UpdatedAt,
            });
        });

        // Replaces the person's settings with these. The page keeps the whole set and sends it whole.
        group.MapPut("/settings", async (MySettings body, AppDbContext db, ICurrentUser user, CancellationToken ct) =>
        {
            var shortcuts = Shortcuts(body.Shortcuts);
            var mouse = Mouse(body.Mouse);
            var errors = new Dictionary<string, string[]>();
            if (shortcuts is null) errors["shortcuts"] = ["The keys could not be read"];
            if (mouse is null) errors["mouse"] = ["The mouse keys could not be read"];
            if (body.Theme is not null && !Themes.Contains(body.Theme)) errors["theme"] = ["Pick light or dark"];
            if (errors.Count == 0 && Encoding.UTF8.GetByteCount(shortcuts! + mouse!) > MaxBytes) errors["shortcuts"] = ["Too many keys to save"];
            if (errors.Count > 0) return Results.ValidationProblem(errors);

            var person = user.Id!.Value;
            var mine = await db.UserSettings.FirstOrDefaultAsync(s => s.UserId == person, ct);
            if (mine is null)
            {
                mine = new UserSettings { UserId = person, Shortcuts = shortcuts!, Mouse = mouse! };
                db.UserSettings.Add(mine);
            }
            mine.Shortcuts = shortcuts!;
            mine.Mouse = mouse!;
            mine.Theme = body.Theme;
            mine.UpdatedAt = DateTimeOffset.UtcNow;
            try
            {
                await db.SaveChangesAsync(ct);
            }
            catch (DbUpdateException)
            {
                // Two tabs saving a first time together: the other one made the row, so this one is one save late.
                // The page sends the whole set each time, so the next change brings them level.
                return Results.Problem("Your settings were saved from another tab at the same moment. Try again",
                    statusCode: StatusCodes.Status409Conflict, title: "Changed meanwhile");
            }
            return Results.Ok(new { updatedAt = mine.UpdatedAt });
        });
    }

    // { "sp.select": ["X"], "nav.overview": ["G", "O"], "sp.hand": [] } with known ids, up to two keys each
    private static string? Shortcuts(JsonElement? given)
    {
        if (given is null || given.Value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined) return "{}";
        if (given.Value.ValueKind != JsonValueKind.Object) return null;
        var clean = new JsonObject();
        foreach (var entry in given.Value.EnumerateObject())
        {
            if (!KnownCommands.Contains(entry.Name) || entry.Value.ValueKind != JsonValueKind.Array) return null;
            var keys = new JsonArray();
            foreach (var key in entry.Value.EnumerateArray())
            {
                if (key.ValueKind != JsonValueKind.String || !Combo().IsMatch(key.GetString()!)) return null;
                keys.Add(key.GetString());
            }
            if (keys.Count > 2 || keys.Count != keys.Select(k => k!.GetValue<string>()).Distinct().Count()) return null;
            clean[entry.Name] = keys;
        }
        // A key never has two owners where both can fire: the same keys, or one the first half of the other's two
        // key sequence, in one page or with a function that works everywhere (conflictsOf in shortcuts.ts)
        var bound = clean.Select(entry => (Id: entry.Key, Keys: entry.Value!.AsArray().Select(k => k!.GetValue<string>()).ToArray()))
            .Where(one => one.Keys.Length > 0).ToList();
        for (var i = 0; i < bound.Count; i++)
        {
            for (var j = i + 1; j < bound.Count; j++)
            {
                if (!SameScope(bound[i].Id, bound[j].Id)) continue;
                var (x, y) = (bound[i].Keys, bound[j].Keys);
                if (x.SequenceEqual(y) || (x.Length == 1 && y.Length == 2 && y[0] == x[0]) || (y.Length == 1 && x.Length == 2 && x[0] == y[0])) return null;
            }
        }
        return clean.ToJsonString();
    }

    // nav. and keys. work on every admin page, ov. only on the Overview and sp. only on the Scratchpad
    private static bool SameScope(string a, string b)
    {
        static string Scope(string id) => id.StartsWith("ov.") ? "overview" : id.StartsWith("sp.") ? "scratchpad" : "global";
        return Scope(a) == Scope(b) || Scope(a) == "global" || Scope(b) == "global";
    }

    // { "mouse.add": "Alt" } with known rows and Shift, Ctrl or Alt
    private static string? Mouse(JsonElement? given)
    {
        if (given is null || given.Value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined) return "{}";
        if (given.Value.ValueKind != JsonValueKind.Object) return null;
        var clean = new JsonObject();
        foreach (var entry in given.Value.EnumerateObject())
        {
            if (!MouseDefaults.ContainsKey(entry.Name) || entry.Value.ValueKind != JsonValueKind.String) return null;
            var key = entry.Value.GetString()!;
            if (!MouseKeys.Contains(key)) return null;
            clean[entry.Name] = key;
        }
        // Two rows holding one key would make one gesture do two things
        var held = MouseDefaults.Select(row => clean[row.Key]?.GetValue<string>() ?? row.Value).ToList();
        if (held.Distinct().Count() != held.Count) return null;
        return clean.ToJsonString();
    }

    // One key press the way the page writes it (comboOf in shortcuts.ts): held keys each at most once and in that
    // order, then one character or one of the named keys the page knows, like "Ctrl+Shift+G", "?", "Esc" or "Plus"
    [GeneratedRegex(@"^(?:Ctrl\+)?(?:Alt\+)?(?:Shift\+)?(?:Cmd\+)?(?:[!-~]|Esc|Left|Right|Up|Down|Space|Plus|Enter|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|F[1-9]|F1[0-2])$")]
    private static partial Regex Combo();
}
