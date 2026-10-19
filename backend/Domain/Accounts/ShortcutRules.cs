using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace api_v2.Domain.Accounts;

// What a person's keyboard and mouse settings may contain. Pure: the same rules the page's shortcuts.ts keeps,
// checked again here so the page is never the only guard.
public static partial class ShortcutRules
{
    // The most a saved set of keys may weigh, so a caller can't fill the row with nonsense
    public const int MaxBytes = 16_000;

    public static readonly string[] Themes = ["light", "dark"];

    // Every function the Shortcuts panel can rebind, with the keys it has until changed: the same ids and defaults as
    // COMMANDS in angular/src/app/services/shortcuts.ts.
    public static readonly Dictionary<string, string[]> CommandDefaults = new()
    {
        ["nav.overview"] = ["G", "O"], ["nav.scratchpad"] = ["G", "S"], ["nav.prev"] = ["["], ["nav.next"] = ["]"], ["keys.open"] = ["?"],
        ["ov.slice1"] = ["1"], ["ov.slice2"] = ["2"], ["ov.slice3"] = ["3"], ["ov.slice4"] = ["4"], ["ov.slice5"] = ["5"],
        ["ov.find"] = ["/"], ["ov.compare"] = ["C"], ["ov.metric"] = ["M"], ["ov.top"] = ["T"], ["ov.clear"] = ["Esc"],
        ["sp.select"] = ["V"], ["sp.hand"] = ["H"], ["sp.line"] = ["L"], ["sp.pen"] = ["P"], ["sp.marker"] = ["M"], ["sp.rect"] = ["R"],
        ["sp.sticky"] = ["N"], ["sp.text"] = ["T"], ["sp.undo"] = ["Ctrl+Z"], ["sp.redo"] = ["Ctrl+Y"],
        ["sp.group"] = ["Ctrl+G"], ["sp.ungroup"] = ["Ctrl+Shift+G"], ["sp.duplicate"] = ["Ctrl+D"], ["sp.selectAll"] = ["Ctrl+A"],
        ["sp.back"] = ["Ctrl+["], ["sp.front"] = ["Ctrl+]"],
        ["sp.zoom100"] = ["Ctrl+0"], ["sp.fit"] = ["Ctrl+1"], ["sp.zoomSel"] = ["Ctrl+2"], ["sp.clear"] = ["Esc"],
    };

    // The Mouse rows whose held key can change, with the key each holds until changed (MOUSE_ROWS in shortcuts.ts)
    public static readonly Dictionary<string, string> MouseDefaults = new()
    {
        ["mouse.add"] = "Shift",
        ["mouse.zoom"] = "Ctrl",
        ["mouse.dup"] = "Alt",
    };

    public static IEnumerable<string> KnownMouseRows => MouseDefaults.Keys;

    private static readonly string[] MouseKeys = ["Shift", "Ctrl", "Alt"];

    // { "sp.select": ["X"], "nav.overview": ["G", "O"], "sp.hand": [] } with known ids, up to two keys each.
    // Answers the keys to keep, or null and why not.
    public static (string? Json, string? Problem) Shortcuts(JsonElement? given)
    {
        if (given is null || given.Value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined) return ("{}", null);
        if (given.Value.ValueKind != JsonValueKind.Object) return (null, null);
        var clean = new JsonObject();
        foreach (var entry in given.Value.EnumerateObject())
        {
            if (!CommandDefaults.ContainsKey(entry.Name)) return (null, $"There is no function called {entry.Name}");
            if (entry.Value.ValueKind != JsonValueKind.Array) return (null, null);
            var keys = new JsonArray();
            foreach (var key in entry.Value.EnumerateArray())
            {
                if (key.ValueKind != JsonValueKind.String || !Combo().IsMatch(key.GetString()!)) return (null, $"The keys for {entry.Name} could not be read");
                keys.Add(key.GetString());
            }
            if (keys.Count > 2) return (null, $"{entry.Name} takes at most two keys in a row");
            if (keys.Count != keys.Select(k => k!.GetValue<string>()).Distinct().Count()) return (null, $"{entry.Name} has the same key twice");
            clean[entry.Name] = keys;
        }
        // A key never has two owners where both can fire: the same keys, or one the first half of the other's two
        // key sequence, in one page or with a function that works everywhere (conflictsOf in shortcuts.ts). Checked
        // on the keys as they will be, so a function left on its default counts too.
        var bound = CommandDefaults
            .Select(entry => (Id: entry.Key, Keys: clean[entry.Key] is JsonArray mine ? mine.Select(k => k!.GetValue<string>()).ToArray() : entry.Value))
            .Where(one => one.Keys.Length > 0).ToList();
        for (var i = 0; i < bound.Count; i++)
        {
            for (var j = i + 1; j < bound.Count; j++)
            {
                if (!SameScope(bound[i].Id, bound[j].Id)) continue;
                var (x, y) = (bound[i].Keys, bound[j].Keys);
                if (x.SequenceEqual(y) || (x.Length == 1 && y.Length == 2 && y[0] == x[0]) || (y.Length == 1 && x.Length == 2 && x[0] == y[0]))
                    return (null, $"{string.Join(" then ", x)} for {bound[i].Id} clashes with {string.Join(" then ", y)} for {bound[j].Id}");
            }
        }
        return (clean.ToJsonString(), null);
    }

    // nav. and keys. work on every admin page, ov. only on the Overview and sp. only on the Scratchpad
    private static bool SameScope(string a, string b)
    {
        static string Scope(string id) => id.StartsWith("ov.") ? "overview" : id.StartsWith("sp.") ? "scratchpad" : "global";
        return Scope(a) == Scope(b) || Scope(a) == "global" || Scope(b) == "global";
    }

    // { "mouse.add": "Alt" } with known rows and Shift, Ctrl or Alt
    public static string? Mouse(JsonElement? given)
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
