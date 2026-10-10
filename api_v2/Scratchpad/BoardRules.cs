using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace api_v2.Scratchpad;

// What a Scratchpad board may hold. The board is one free form JSON document, so it is checked by hand here,
// in one place: each kind of thing on the board has its own rule in ItemRules, and lines and groups are checked
// against the things they point at. The page keeps the same shapes in angular/src/app/models/board.ts.
public static partial class BoardRules
{
    public const int MaxBytes = 1_000_000;
    public const int MaxItems = 500;
    public const int MaxLines = 1000;
    public const int MaxGroups = 200;
    public const int MaxText = 10_000;
    public const int MaxBlocks = 200;
    public const int MaxStrokePoints = 2000;
    public const int MaxBoardPoints = 50_000;
    public const int MaxSnapNumbers = 50;
    public const int MaxSnapBytes = 16_000;
    public const double MinZoom = 0.1;
    public const double MaxZoom = 4.0;
    private const double Far = 1_000_000;
    private const double Biggest = 20_000;

    private static readonly string[] Tones = ["white", "gray", "ink", "amber"];
    private static readonly string[] Aligns = ["left", "center", "right"];
    private static readonly string[] Lists = ["none", "bullet", "number"];
    private static readonly string[] Sizes = ["sm", "base", "lg", "xl"];
    private static readonly string[] Heads = ["none", "end", "both"];

    // One rule per kind of thing. A rule answers null when the thing is fine, or the plain reason it is not.
    // The shared checks (id, place and size) run first, in Check, so a rule only says what is its own.
    private static readonly Dictionary<string, Func<JsonObject, string?>> ItemRules = new()
    {
        ["industry"] = item => Number(item["industryId"]) is null ? "A company card has lost its company" : null,
        ["note"] = Paper,
        ["text"] = Paper,
        ["file"] = item => item["fileId"] is not null && Number(item["fileId"]) is null ? "A file card has lost its file" : null,
        ["snap"] = item => item["snap"] is JsonObject snap ? Snapshot(snap) : "A snapshot on the board could not be read",
        ["stroke"] = Stroke,
        ["rect"] = item => OneOf(item["tone"], Tones) ? null : "A box on the board has a colour this page does not know",
    };

    // The checked board, ready to store, or the plain reasons it can't be saved.
    // The view and the carry tray are not part of a board: they are kept apart, so they are dropped here.
    public static (string? Json, Dictionary<string, string[]> Errors) Check(JsonElement document)
    {
        if (Parse(document) is not JsonObject root) return Fail("document", "The board could not be read");

        if (!(root["version"] is JsonValue version && version.TryGetValue<double>(out var v) && v == 1))
        {
            return Fail("version", "This board was made by a page this one does not know");
        }

        root.Remove("view");
        root.Remove("tray");

        if (root["items"] is not JsonArray items) return Fail("items", "The board's things could not be read");
        if (items.Count > MaxItems) return Fail("items", $"A board holds at most {MaxItems} things");

        var ids = new HashSet<string>();
        var points = 0;
        foreach (var node in items)
        {
            if (node is not JsonObject item) return Fail("items", "The board's things could not be read");
            var why = Item(item, ids);
            if (why is not null) return Fail("items", why);
            if (item["points"] is JsonArray stroke) points += stroke.Count / 2;
        }
        if (points > MaxBoardPoints) return Fail("items", "There is too much drawing on this board to save");

        root["lines"] ??= new JsonArray();
        root["groups"] ??= new JsonArray();
        var lineError = Lines(root["lines"], ids);
        if (lineError is not null) return Fail("lines", lineError);
        var groupError = Groups(root["groups"], ids);
        if (groupError is not null) return Fail("groups", groupError);

        var json = root.ToJsonString();
        if (Encoding.UTF8.GetByteCount(json) > MaxBytes) return Fail("document", "This board is too big to save");
        return (json, []);
    }

    // Where a person left a board, tidied: a far off place or a zoom past the limits is brought back
    public static string? View(JsonElement view)
    {
        if (Parse(view) is not JsonObject node) return null;
        var x = Number(node["x"]) ?? 0;
        var y = Number(node["y"]) ?? 0;
        var zoom = Number(node["zoom"]) ?? 1;
        return new JsonObject
        {
            ["x"] = Math.Clamp(x, -Far * MaxZoom, Far * MaxZoom),
            ["y"] = Math.Clamp(y, -Far * MaxZoom, Far * MaxZoom),
            ["zoom"] = Math.Clamp(zoom, MinZoom, MaxZoom),
        }.ToJsonString();
    }

    // A frozen picture from the Overview, on its way in the carry tray or on the board
    public static string? Snapshot(JsonObject snap)
    {
        if (!Text(snap["id"], 1, 64)) return "A snapshot has lost its name";
        if (!OneOf(snap["kind"], ["circle", "list"])) return "A snapshot is of something this page does not know";
        if (!Text(snap["title"], 0, 200) || !Text(snap["takenAt"], 0, 40)) return "A snapshot could not be read";
        if (snap["numbers"] is not JsonArray numbers || numbers.Count > MaxSnapNumbers) return "A snapshot holds too many numbers";
        foreach (var one in numbers)
        {
            if (one is not JsonObject row || !Text(row["label"], 0, 100) || !Text(row["value"], 0, 50)) return "A snapshot could not be read";
            if (row["share"] is not null && Number(row["share"]) is null) return "A snapshot could not be read";
        }
        if (snap["split"] is not null && !Text(snap["split"], 0, 40)) return "A snapshot could not be read";
        if (snap["pick"] is not null && !Text(snap["pick"], 0, 100)) return "A snapshot could not be read";
        if (Encoding.UTF8.GetByteCount(snap.ToJsonString()) > MaxSnapBytes) return "A snapshot is too big";
        return null;
    }

    public static JsonNode? Parse(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object) return null;
        try
        {
            return JsonNode.Parse(element.GetRawText());
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string? Item(JsonObject item, HashSet<string> ids)
    {
        if (!Text(item["id"], 1, 64)) return "A thing on the board has lost its name";
        if (!ids.Add(item["id"]!.GetValue<string>())) return "Two things on the board share a name";
        var type = item["type"] is JsonValue t && t.TryGetValue<string>(out var name) ? name : null;
        if (type is null || !ItemRules.TryGetValue(type, out var rule)) return "The board has something this page does not understand";
        var x = Number(item["x"]);
        var y = Number(item["y"]);
        var w = Number(item["w"]);
        var h = Number(item["h"]);
        if (x is null || y is null || w is null || h is null || Math.Abs(x.Value) > Far || Math.Abs(y.Value) > Far)
        {
            return "A thing on the board is in an impossible place";
        }
        if (w < 0 || h < 0 || w > Biggest || h > Biggest) return "A thing on the board is an impossible size";
        return rule(item);
    }

    private static string? Paper(JsonObject item)
    {
        if (item["tone"] is not null && !OneOf(item["tone"], Tones)) return "A note has a colour this page does not know";
        if (item["align"] is not null && !OneOf(item["align"], Aligns)) return "A note could not be read";
        if (item["text"] is not null && !Text(item["text"], 0, MaxText)) return $"A note holds at most {MaxText} characters";
        if (item["blocks"] is null) return null;
        if (item["blocks"] is not JsonArray blocks || blocks.Count > MaxBlocks) return "A note has too many lines";
        var length = 0;
        foreach (var node in blocks)
        {
            if (node is not JsonObject block || block["runs"] is not JsonArray runs) return "A note could not be read";
            if (block["list"] is not null && !OneOf(block["list"], Lists)) return "A note could not be read";
            foreach (var runNode in runs)
            {
                if (runNode is not JsonObject run || !Text(run["text"], 0, MaxText)) return "A note could not be read";
                length += run["text"]!.GetValue<string>().Length;
                if (run["font"] is not null && !(Text(run["font"], 1, 40) && FontName().IsMatch(run["font"]!.GetValue<string>()))) return "A note uses a font this page does not know";
                if (run["size"] is not null && !OneOf(run["size"], Sizes)) return "A note could not be read";
            }
        }
        return length > MaxText ? $"A note holds at most {MaxText} characters" : null;
    }

    // A pen or marker stroke: its points as one flat list, x then y, measured from the stroke's own corner
    private static string? Stroke(JsonObject item)
    {
        if (!OneOf(item["kind"], ["pen", "marker"])) return "A drawing on the board could not be read";
        if (item["points"] is not JsonArray points || points.Count < 2 || points.Count % 2 != 0) return "A drawing on the board could not be read";
        if (points.Count / 2 > MaxStrokePoints) return "A drawing on the board is too long";
        foreach (var point in points)
        {
            var n = Number(point);
            if (n is null || Math.Abs(n.Value) > Biggest) return "A drawing on the board could not be read";
        }
        return null;
    }

    private static string? Lines(JsonNode? node, HashSet<string> ids)
    {
        if (node is not JsonArray lines) return "The board's lines could not be read";
        if (lines.Count > MaxLines) return $"A board holds at most {MaxLines} lines";
        var seen = new HashSet<string>();
        foreach (var lineNode in lines)
        {
            if (lineNode is not JsonObject line || !Text(line["id"], 1, 64) || !seen.Add(line["id"]!.GetValue<string>())) return "A line on the board could not be read";
            if (!(Text(line["from"], 1, 64) && ids.Contains(line["from"]!.GetValue<string>()) && Text(line["to"], 1, 64) && ids.Contains(line["to"]!.GetValue<string>())))
            {
                return "A line is joined to something that is not on the board";
            }
            if (line["head"] is not null && !OneOf(line["head"], Heads)) return "A line on the board could not be read";
            if (line["bend"] is not null && Number(line["bend"]) is not (-1 or 0 or 1)) return "A line on the board could not be read";
            if (line["label"] is not null && !Text(line["label"], 0, 200)) return "A line's label is longer than 200 characters";
        }
        return null;
    }

    private static string? Groups(JsonNode? node, HashSet<string> ids)
    {
        if (node is not JsonArray groups) return "The board's groups could not be read";
        if (groups.Count > MaxGroups) return $"A board holds at most {MaxGroups} groups";
        var grouped = new HashSet<string>();
        foreach (var groupNode in groups)
        {
            if (groupNode is not JsonObject group || !Text(group["id"], 1, 64) || !Text(group["name"], 0, 60)) return "A group on the board could not be read";
            if (group["itemIds"] is not JsonArray members || members.Count < 2) return "A group needs two things or more";
            foreach (var member in members)
            {
                if (!Text(member, 1, 64) || !ids.Contains(member!.GetValue<string>())) return "A group holds something that is not on the board";
                if (!grouped.Add(member.GetValue<string>())) return "A thing on the board is in two groups";
            }
        }
        return null;
    }

    private static double? Number(JsonNode? node) =>
        node is JsonValue value && value.TryGetValue<double>(out var number) && double.IsFinite(number) ? number : null;

    private static bool Text(JsonNode? node, int min, int max) =>
        node is JsonValue value && value.TryGetValue<string>(out var text) && text.Length >= min && text.Length <= max;

    private static bool OneOf(JsonNode? node, string[] allowed) =>
        node is JsonValue value && value.TryGetValue<string>(out var text) && allowed.Contains(text);

    private static (string? Json, Dictionary<string, string[]> Errors) Fail(string key, string message) =>
        (null, new() { [key] = [message] });

    // Font family names as Google Fonts spells them: letters, digits and spaces
    [GeneratedRegex("^[A-Za-z0-9 ]+$")]
    private static partial Regex FontName();
}
