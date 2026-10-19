using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Xunit;
using Xunit.Abstractions;

namespace api_v2.Tests.Smoke;

// One walk through every part of the app the way a person uses it, against a fresh database: the API migrates both
// chains, makes the first admin, and each step checks the status it should answer, not only that nothing failed.
// Steps run in order because each builds on the last (signed in, a row added, a table made...).
[Trait("Category", "Smoke")]
public sealed class SmokeFlow(SmokeHost host, ITestOutputHelper output) : IClassFixture<SmokeHost>
{
    private const string NewPassword = "Smoke-Run-2026-strong";

    [Fact]
    public async Task The_whole_app_answers_as_before()
    {
        using var api = host.CreateClient();

        // Starting up: both migration chains apply and History comes up
        var health = await WaitForReadyAsync(api);
        Assert.Equal("ready", health["state"]?.GetValue<string>());
        var startupLines = host.Logs.Lines.Count;
        Assert.True(health["history"]?["ready"]?.GetValue<bool>(), "History should be ready");

        // Not signed in: browsing works, writing doesn't
        await Expect(api, HttpMethod.Get, "/industries", null, HttpStatusCode.OK);
        await Expect(api, HttpMethod.Post, "/industries", new { name = "Nobody's row", sector = "Tech" }, HttpStatusCode.Unauthorized);
        await Expect(api, HttpMethod.Get, "/auth/me", null, HttpStatusCode.Unauthorized);

        // The first start made an admin and printed the password once
        var firstPassword = host.Logs.Value("Password");
        Assert.False(string.IsNullOrEmpty(firstPassword), "The API should print the new admin's password");
        await Expect(api, HttpMethod.Post, "/auth/login", new { username = "admin", password = "wrong" }, HttpStatusCode.Unauthorized);
        var login = await Expect(api, HttpMethod.Post, "/auth/login", new { username = "admin", password = firstPassword }, HttpStatusCode.OK);
        api.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login!["token"]!.GetValue<string>());

        // A new admin has to pick a password before anything else
        await Expect(api, HttpMethod.Get, "/users", null, HttpStatusCode.Forbidden);
        await Expect(api, HttpMethod.Post, "/auth/password", new { current = firstPassword, @new = NewPassword }, HttpStatusCode.OK);
        var me = await Expect(api, HttpMethod.Get, "/auth/me", null, HttpStatusCode.OK);
        Assert.Equal("admin", me!["username"]?.GetValue<string>() ?? me["user"]?["username"]?.GetValue<string>());

        // Rules
        var schema = await Expect(api, HttpMethod.Get, "/schema", null, HttpStatusCode.OK);
        Assert.NotNull(schema);
        await Expect(api, HttpMethod.Get, "/schema/versions", null, HttpStatusCode.OK);

        // Industries: add, read, search, edit, refuse a name that's already there, delete
        var row = await Expect(api, HttpMethod.Post, "/industries",
            new { name = "Smoke Test Co", sector = "Tech", price = 5.5m, release = "2026-10-19" }, HttpStatusCode.Created);
        var rowId = row!["id"]!.GetValue<int>();
        await Expect(api, HttpMethod.Get, $"/industries/{rowId}", null, HttpStatusCode.OK);
        var found = await Expect(api, HttpMethod.Get, "/industries/search?q=smoke", null, HttpStatusCode.OK);
        Assert.Contains(found!.AsArray(), r => r?["id"]?.GetValue<int>() == rowId);
        await Expect(api, HttpMethod.Get, "/industries/top?limit=5", null, HttpStatusCode.OK);
        await Expect(api, HttpMethod.Get, $"/industries/by-ids?ids={rowId}", null, HttpStatusCode.OK);
        await Expect(api, HttpMethod.Get, "/industries/activity", null, HttpStatusCode.OK);
        await Expect(api, HttpMethod.Put, $"/industries/update/{rowId}",
            new { name = "Smoke Test Co", sector = "Energy", price = 6m, release = "2026-10-19" }, HttpStatusCode.NoContent);
        // Same name ignoring case, accents and spaces is the same name
        await Expect(api, HttpMethod.Post, "/industries", new { name = "smoke  test có", sector = "Tech" }, HttpStatusCode.Conflict);
        await Expect(api, HttpMethod.Post, "/industries", new { name = "", sector = "Tech" }, HttpStatusCode.BadRequest);
        await Expect(api, HttpMethod.Delete, $"/industries/{rowId}", null, HttpStatusCode.OK);
        await Expect(api, HttpMethod.Get, $"/industries/{rowId}", null, HttpStatusCode.NotFound);

        // Tables page: a table, a row added, edited and deleted, the CSV, then into the bin and back
        var table = await Expect(api, HttpMethod.Post, "/tables", new
        {
            name = "Smoke table",
            columns = new object[] { new { label = "Item", type = "text", required = true }, new { label = "Count", type = "number" } }
        }, HttpStatusCode.Created);
        var tableId = table!["id"]!.GetValue<int>();
        var columns = table["columns"]!.AsArray().Select(c => c!["key"]!.GetValue<string>()).ToArray();
        var tableRow = await Expect(api, HttpMethod.Post, $"/tables/{tableId}/rows",
            new { values = new Dictionary<string, object> { [columns[0]] = "Bolts", [columns[1]] = 40 } }, HttpStatusCode.Created);
        var tableRowId = tableRow!["id"]!.GetValue<int>();
        await Expect(api, HttpMethod.Put, $"/tables/{tableId}/rows/{tableRowId}", new
        {
            values = new Dictionary<string, object> { [columns[0]] = "Bolts", [columns[1]] = 41 },
            updatedAt = tableRow["updatedAt"]!.GetValue<DateTimeOffset>()
        }, HttpStatusCode.OK);
        var rows = await Expect(api, HttpMethod.Get, $"/tables/{tableId}/rows", null, HttpStatusCode.OK);
        Assert.Equal(1, rows!["total"]!.GetValue<int>());
        var csv = await api.GetAsync($"/tables/{tableId}/export.csv");
        Assert.Equal(HttpStatusCode.OK, csv.StatusCode);
        Assert.Contains("Bolts", await csv.Content.ReadAsStringAsync());
        await Expect(api, HttpMethod.Delete, $"/tables/{tableId}/rows/{tableRowId}", null, HttpStatusCode.OK);
        await Expect(api, HttpMethod.Delete, $"/tables/{tableId}", null, HttpStatusCode.OK);
        await Expect(api, HttpMethod.Get, "/tables/bin", null, HttpStatusCode.OK);
        await Expect(api, HttpMethod.Post, $"/tables/{tableId}/restore", null, HttpStatusCode.OK);
        await Expect(api, HttpMethod.Get, "/tables", null, HttpStatusCode.OK);

        // Scratchpad: a board made, read, saved, a stale save refused, renamed, deleted; the tray read
        var emptyBoard = new { version = 1, items = Array.Empty<object>(), lines = Array.Empty<object>(), groups = Array.Empty<object>() };
        var board = await Expect(api, HttpMethod.Post, "/scratchpad/boards", new { name = "Smoke board", document = emptyBoard }, HttpStatusCode.Created);
        var boardId = board!["id"]!.GetValue<int>();
        var opened = await Expect(api, HttpMethod.Get, $"/scratchpad/boards/{boardId}", null, HttpStatusCode.OK);
        var note = new { id = "n1", kind = "note", x = 10, y = 10, w = 200, h = 120, text = "hello", tone = "yellow" };
        var saved = await Expect(api, HttpMethod.Put, $"/scratchpad/boards/{boardId}", new
        {
            document = opened!["document"],
            updatedAt = opened["updatedAt"]!.GetValue<DateTimeOffset>()
        }, HttpStatusCode.OK);
        await Expect(api, HttpMethod.Put, $"/scratchpad/boards/{boardId}", new
        {
            document = opened["document"],
            updatedAt = opened["updatedAt"]!.GetValue<DateTimeOffset>().AddMinutes(-5)
        }, HttpStatusCode.Conflict);
        Assert.NotNull(saved!["updatedAt"]);
        await Expect(api, HttpMethod.Put, $"/scratchpad/boards/{boardId}", new { document = new { version = 7, items = new[] { note } } },
            HttpStatusCode.BadRequest);
        await Expect(api, HttpMethod.Patch, $"/scratchpad/boards/{boardId}", new { name = "Smoke board renamed" }, HttpStatusCode.OK);
        await Expect(api, HttpMethod.Get, "/scratchpad/boards", null, HttpStatusCode.OK);
        await Expect(api, HttpMethod.Get, "/scratchpad/tray", null, HttpStatusCode.OK);
        await Expect(api, HttpMethod.Delete, $"/scratchpad/boards/{boardId}", null, HttpStatusCode.OK);

        // Requests: ask, read, reply, the bell count, mark done
        var ask = await Expect(api, HttpMethod.Post, "/requests", new { title = "Smoke ask", details = "Checking **requests** work" },
            HttpStatusCode.Created);
        var requestId = ask!["id"]!.GetValue<int>();
        await Expect(api, HttpMethod.Get, $"/requests/{requestId}", null, HttpStatusCode.OK);
        await Expect(api, HttpMethod.Post, $"/requests/{requestId}/messages", new { body = "A reply" }, HttpStatusCode.OK);
        await Expect(api, HttpMethod.Get, "/requests/count", null, HttpStatusCode.OK);
        await Expect(api, HttpMethod.Get, "/requests?status=all", null, HttpStatusCode.OK);
        await Expect(api, HttpMethod.Put, $"/requests/{requestId}/status", new { status = "done" }, HttpStatusCode.OK);

        // Users: list, add a normal account, a note on them, then remove them
        await Expect(api, HttpMethod.Get, "/users", null, HttpStatusCode.OK);
        var viewer = await Expect(api, HttpMethod.Post, "/users", new { username = "smokeperson", role = "normal" }, HttpStatusCode.Created);
        var viewerId = (viewer!["user"] ?? viewer)["id"]!.GetValue<int>();
        await Expect(api, HttpMethod.Post, $"/users/{viewerId}/notes", new { text = "Made by the smoke run" }, null);
        await Expect(api, HttpMethod.Get, $"/users/{viewerId}/notes", null, HttpStatusCode.OK);
        await Expect(api, HttpMethod.Delete, $"/users/{viewerId}", null, null);

        // Backups list (making one needs pg_dump and is not part of the smoke run)
        await Expect(api, HttpMethod.Get, "/backups", null, HttpStatusCode.OK);

        // History: the versions the steps above left, the retention settings, the settings file
        var versions = await Expect(api, HttpMethod.Get, "/history/versions", null, HttpStatusCode.OK);
        Assert.NotNull(versions);
        await Expect(api, HttpMethod.Get, "/history/settings", null, HttpStatusCode.OK);
        var settingsFile = await Expect(api, HttpMethod.Get, "/history/settings/export", null, HttpStatusCode.OK);
        await Expect(api, HttpMethod.Post, "/history/settings/import/preview", settingsFile, HttpStatusCode.OK);

        // The person's own settings and profile
        var mine = await Expect(api, HttpMethod.Get, "/me/settings", null, HttpStatusCode.OK);
        await Expect(api, HttpMethod.Put, "/me/settings", new { theme = "dark", shortcuts = mine!["shortcuts"], mouse = mine["mouse"] },
            HttpStatusCode.OK);
        await Expect(api, HttpMethod.Put, "/me/profile", new { displayName = "Smoke Admin" }, HttpStatusCode.OK);

        // Bad JSON is a plain 400, not a crash
        var broken = await api.PostAsync("/industries", new StringContent("{not json", System.Text.Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.BadRequest, broken.StatusCode);

        await Expect(api, HttpMethod.Post, "/auth/logout", null, HttpStatusCode.NoContent);
        await Expect(api, HttpMethod.Get, "/auth/me", null, HttpStatusCode.Unauthorized);

        // Nothing after startup was logged as an unexpected failure. Startup itself logs EF's probes of an empty
        // database at Error, which is how EF finds there is nothing there yet.
        var crashes = host.Logs.Lines.Skip(startupLines).Where(l => l.Level >= Microsoft.Extensions.Logging.LogLevel.Error).Select(l => l.Text).ToList();
        Assert.True(crashes.Count == 0, "Errors were logged:\n" + string.Join("\n", crashes));
    }

    // The OpenAPI document, written out when SMOKE_OPENAPI_OUT names a file, so two trees can be compared
    [Fact]
    public async Task The_openapi_document_is_served()
    {
        using var api = host.CreateClient();
        var answer = await api.GetAsync("/openapi/v1.json");
        Assert.Equal(HttpStatusCode.OK, answer.StatusCode);
        var text = await answer.Content.ReadAsStringAsync();
        var outFile = Environment.GetEnvironmentVariable("SMOKE_OPENAPI_OUT");
        if (!string.IsNullOrEmpty(outFile)) await File.WriteAllTextAsync(outFile, text);
    }

    private async Task<JsonObject> WaitForReadyAsync(HttpClient api)
    {
        JsonObject? last = null;
        for (var i = 0; i < 120; i++)
        {
            last = (await api.GetFromJsonAsync<JsonObject>("/health"))!;
            if (last["state"]?.GetValue<string>() == "ready" && last["history"]?["ready"]?.GetValue<bool>() == true) return last;
            if (last["state"]?.GetValue<string>() == "failed") break;
            await Task.Delay(500);
        }
        return last!;
    }

    // Sends one step and checks its status. A null expected status only refuses a server error.
    private async Task<JsonNode?> Expect(HttpClient api, HttpMethod method, string path, object? body, HttpStatusCode? expected)
    {
        using var request = new HttpRequestMessage(method, path);
        if (body is not null) request.Content = JsonContent.Create(body);
        using var answer = await api.SendAsync(request);
        var text = await answer.Content.ReadAsStringAsync();
        output.WriteLine($"{method} {path} -> {(int)answer.StatusCode}");
        if (expected is { } want)
        {
            Assert.True(answer.StatusCode == want, $"{method} {path}: expected {(int)want}, got {(int)answer.StatusCode}: {text}");
        }
        else
        {
            Assert.True((int)answer.StatusCode < 500, $"{method} {path}: got {(int)answer.StatusCode}: {text}");
        }
        if (string.IsNullOrWhiteSpace(text)) return null;
        try { return JsonNode.Parse(text); } catch (JsonException) { return JsonValue.Create(text); }
    }
}
