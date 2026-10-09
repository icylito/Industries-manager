using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.Json.Nodes;
using api_v2.Data;
using api_v2.Model;
using Microsoft.EntityFrameworkCore;

namespace api_v2.Tables;

// A readable copy of every table from the Tables page, one JSON file each, so anyone looking at the PC can see
// what was made, by whom and how big it is. The database is the real storage: the API never reads these
// files back, so editing one changes nothing. UserTables:Mirror picks the folder, default user-tables/ at the
// repo root. It is rebuilt from the database on start and after a restore, so it can't drift for long.
public sealed class UserTableMirror
{
    private const string ReadMe =
        "A readable copy made by the API. The database is the real storage: editing this file changes nothing.";
    private static readonly TimeSpan Debounce = TimeSpan.FromSeconds(2);
    private static readonly JsonSerializerOptions Pretty = new(TableShape.Json) { WriteIndented = true };

    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<UserTableMirror> _log;
    private readonly ConcurrentDictionary<int, CancellationTokenSource> _pending = new();
    private readonly SemaphoreSlim _writing = new(1, 1);

    public string Root { get; }
    public string DeletedFolder => Path.Combine(Root, "deleted");

    public UserTableMirror(IConfiguration config, IWebHostEnvironment env, IServiceScopeFactory scopes, ILogger<UserTableMirror> log)
    {
        _scopes = scopes;
        _log = log;
        var configured = config["UserTables:Mirror"];
        Root = string.IsNullOrWhiteSpace(configured)
            ? Path.GetFullPath(Path.Combine(env.ContentRootPath, "..", "user-tables"))
            : Path.GetFullPath(configured.Trim(), env.ContentRootPath);

        // A folder under the web root would be handed straight to the browser, so refuse to start that way
        if (!string.IsNullOrEmpty(env.WebRootPath))
        {
            var relative = Path.GetRelativePath(Path.GetFullPath(env.WebRootPath), Root);
            if (!relative.StartsWith("..") && !Path.IsPathRooted(relative))
            {
                throw new InvalidOperationException("UserTables:Mirror has to be outside the web root, see appsettings");
            }
        }
        Directory.CreateDirectory(Root);
        Directory.CreateDirectory(DeletedFolder);
    }

    // After a change is saved. A burst of edits to one table writes its file once, about 2 seconds later.
    public void Changed(int tableId)
    {
        var next = new CancellationTokenSource();
        var previous = _pending.AddOrUpdate(tableId, next, (_, old) => { old.Cancel(); return next; });
        _ = Task.Run(async () =>
        {
            try
            {
                await Task.Delay(Debounce, next.Token);
                _pending.TryRemove(new KeyValuePair<int, CancellationTokenSource>(tableId, next));
                await WriteTableAsync(tableId, CancellationToken.None);
                await WriteIndexAsync(CancellationToken.None);
            }
            catch (OperationCanceledException)
            {
                // A newer change to the same table took over
            }
            catch (Exception ex)
            {
                // The copy is only for reading, a failure here never fails the change itself
                _log.LogWarning(ex, "Couldn't write the copy of table {Table} to {Folder}", tableId, Root);
            }
            finally
            {
                next.Dispose();
            }
        });
    }

    // Every file is written again from the database, and files for tables that no longer exist are removed
    public async Task RebuildAsync(CancellationToken ct)
    {
        using var scope = _scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var ids = await db.UserTables.AsNoTracking().Select(t => t.Id).ToListAsync(ct);
        foreach (var id in ids) await WriteTableAsync(id, ct);

        var known = ids.ToHashSet();
        foreach (var file in Directory.EnumerateFiles(Root, "*.json").Concat(Directory.EnumerateFiles(DeletedFolder, "*.json")))
        {
            if (IdOf(file) is int id && !known.Contains(id)) TryDelete(file);
        }
        await WriteIndexAsync(ct);
        _log.LogInformation("Wrote the readable copies of {Count} table(s) to {Folder}", ids.Count, Root);
    }

    // The table is gone from the database for good, so its file goes too
    public async Task RemovedAsync(int tableId, CancellationToken ct)
    {
        foreach (var file in FilesFor(tableId)) TryDelete(file);
        await WriteIndexAsync(ct);
    }

    private async Task WriteTableAsync(int tableId, CancellationToken ct)
    {
        await _writing.WaitAsync(ct);
        try
        {
            using var scope = _scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var table = await db.UserTables.AsNoTracking().FirstOrDefaultAsync(t => t.Id == tableId, ct);
            if (table is null)
            {
                foreach (var file in FilesFor(tableId)) TryDelete(file);
                return;
            }

            var folder = table.DeletedAt is null ? Root : DeletedFolder;
            var target = Path.Combine(folder, $"{table.Id}-{TableShape.Slug(table.Name)}.json");
            var temp = target + ".writing";

            // Streamed row by row, so a table with 100,000 rows never sits in memory as one document
            await using (var stream = new FileStream(temp, FileMode.Create, FileAccess.Write, FileShare.None))
            await using (var json = new Utf8JsonWriter(stream, new JsonWriterOptions { Indented = true }))
            {
                json.WriteStartObject();
                json.WriteString("readMe", ReadMe);
                json.WriteNumber("id", table.Id);
                json.WriteString("name", table.Name);
                json.WriteString("createdBy", table.CreatedBy);
                json.WriteString("createdAt", table.CreatedAt);
                json.WriteString("updatedAt", table.UpdatedAt);
                if (table.DeletedAt is DateTimeOffset deleted) json.WriteString("deletedAt", deleted);
                json.WriteNumber("rowCount", table.RowCount);
                json.WritePropertyName("columns");
                JsonNode.Parse(table.Columns)!.WriteTo(json);
                json.WriteStartArray("rows");
                await foreach (var row in db.UserTableRows.AsNoTracking().Where(r => r.TableId == tableId)
                    .OrderBy(r => r.Id).AsAsyncEnumerable().WithCancellation(ct))
                {
                    json.WriteStartObject();
                    json.WriteNumber("id", row.Id);
                    json.WritePropertyName("data");
                    JsonNode.Parse(row.Data)!.WriteTo(json);
                    json.WriteString("createdBy", row.CreatedBy);
                    json.WriteString("updatedAt", row.UpdatedAt);
                    json.WriteEndObject();
                }
                json.WriteEndArray();
                json.WriteEndObject();
            }

            // Written beside it first and then swapped in, so a half-written file is never there to read
            File.Move(temp, target, overwrite: true);
            // A rename or a move to or from the bin leaves the old file behind, so clear it
            foreach (var file in FilesFor(tableId).Where(f => !string.Equals(f, target, StringComparison.OrdinalIgnoreCase)))
            {
                TryDelete(file);
            }
        }
        finally
        {
            _writing.Release();
        }
    }

    // _index.json: every table with its size on disk, so the folder can be read at a glance
    private async Task WriteIndexAsync(CancellationToken ct)
    {
        using var scope = _scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var tables = await db.UserTables.AsNoTracking().OrderBy(t => t.Id).ToListAsync(ct);
        var entries = tables.Select(t =>
        {
            var file = FilesFor(t.Id).FirstOrDefault();
            return new
            {
                t.Id,
                t.Name,
                File = file is null ? null : Path.GetRelativePath(Root, file).Replace('\\', '/'),
                Bytes = file is null ? 0 : new FileInfo(file).Length,
                t.RowCount,
                t.CreatedBy,
                t.CreatedAt,
                t.UpdatedAt,
                InBin = t.DeletedAt is not null,
            };
        }).ToList();

        var index = new
        {
            readMe = ReadMe,
            writtenAt = DateTimeOffset.UtcNow,
            tables = entries.Count,
            totalBytes = entries.Sum(e => e.Bytes),
            list = entries,
        };
        var target = Path.Combine(Root, "_index.json");
        await _writing.WaitAsync(ct);
        try
        {
            await File.WriteAllTextAsync(target + ".writing", JsonSerializer.Serialize(index, Pretty), ct);
            File.Move(target + ".writing", target, overwrite: true);
        }
        finally
        {
            _writing.Release();
        }
    }

    private IEnumerable<string> FilesFor(int tableId) =>
        Directory.EnumerateFiles(Root, $"{tableId}-*.json").Concat(Directory.EnumerateFiles(DeletedFolder, $"{tableId}-*.json"))
            .Where(f => IdOf(f) == tableId);

    // "12-leads.json" belongs to table 12. Anything else in the folder is left alone.
    private static int? IdOf(string file)
    {
        var name = Path.GetFileNameWithoutExtension(file);
        var dash = name.IndexOf('-');
        return dash > 0 && int.TryParse(name[..dash], out var id) ? id : null;
    }

    private void TryDelete(string file)
    {
        try
        {
            File.Delete(file);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            _log.LogWarning(ex, "Couldn't remove {File}, it goes on the next rebuild", file);
        }
    }
}
