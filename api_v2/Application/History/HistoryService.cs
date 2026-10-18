using System.Globalization;
using System.Text;
using System.Text.Json;
using api_v2.Application.Health;
using api_v2.Application.Ports;
using api_v2.Application.Requests;
using api_v2.Application.Settings;
using api_v2.Domain.Collector;
using api_v2.Domain.Export;
using api_v2.Domain.Rules;

namespace api_v2.Application.History;

// The History page: saved versions, pinning and deleting them, restore and import, and the retention setting that
// decides which old copies go. Every call that changes the table takes the table lock first, the collector is only
// reached through ICollectorStore, and the rows themselves are fitted and written by ITableWriter. The restore's one
// transaction lives behind IHistoryRestoreRunner, so the rules and the developer request go in with the rows.
public class HistoryService(
    ICollectorStore collector,
    ITableWriter writer,
    IHistoryRestoreRunner restoreRunner,
    RulesService rules,
    SettingsService settings,
    ISettingsStore settingsStore,
    RequestService requests,
    IAppLocks locks,
    DatabaseStatus status,
    ILogger<HistoryService> log)
{
    // The longest a restore note can be, counted in the same UTF-16 characters the page counts. The page checks the
    // same limit in Components/history/history.ts (noteMax), change both together.
    public const int NoteMax = 300;

    // The message the page shows before importing data saved under other rules
    public const string RulesDifferMessage = "The old data follows different rules than the table does now. Import it anyway?";

    // The retention setting as the page shows it
    public Retention Retention => settings.Retention;

    // Saved versions, newest first. SameLayout says if the table looked the same back then.
    public async Task<IReadOnlyList<VersionListItem>> VersionsAsync(CancellationToken ct)
    {
        var versions = await collector.ListVersionsAsync(ct);
        // The reason is clipped here, so one oversized note saved before the limit existed can't slow the page down.
        // One version's own answer (GET /versions/{id}) still carries it whole.
        return versions.Select(v => new VersionListItem(
            v.Id, v.CreatedAt, CollectorText.Clip(v.Reason), v.CreatedBy, v.RowCount, v.RulesVersion, v.Pinned, v.Damaged,
            SameLayout: !v.Damaged && status.SameLayout(v.Migrations))).ToList();
    }

    // One version with its rows, for View
    public async Task<VersionView?> VersionAsync(long id, CancellationToken ct)
    {
        var v = await collector.GetVersionAsync(id, ct);
        if (v is null) return null;
        return new VersionView(
            v.Summary.Id, v.Summary.CreatedAt, v.Summary.Reason, v.Summary.CreatedBy, v.Summary.RowCount,
            v.Summary.RulesVersion, v.Summary.Pinned, v.Summary.Damaged,
            status.SameLayout(v.Summary.Migrations),
            v.Columns.Select(c => c.Name).ToList(),
            v.Rules is null ? null : RulesService.ParseFields(v.Rules),
            v.Rows);
    }

    // A version as a CSV file, opens in Excel
    public async Task<VersionDownload?> DownloadAsync(long id, CancellationToken ct)
    {
        var v = await collector.GetVersionAsync(id, ct);
        if (v is null) return null;
        var columns = v.Columns.Select(c => c.Name).ToList();
        var csv = new StringBuilder();
        csv.AppendLine(string.Join(",", columns.Select(c => CsvText.Cell(CsvText.GuardFormula(c)))));
        foreach (var row in v.Rows)
        {
            csv.AppendLine(string.Join(",", columns.Select(c =>
                row.TryGetProperty(c, out var value) ? CsvText.Cell(CellText(value)) : "")));
        }
        var bytes = Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(csv.ToString())).ToArray();
        return new VersionDownload(bytes, $"version-{id}-{v.Summary.CreatedAt:yyyy-MM-dd}.csv");
    }

    // Pinned versions never get removed by retention
    public Task<bool> PinAsync(long id, bool pinned, CancellationToken ct) =>
        collector.SetPinnedAsync(id, pinned, ct);

    // Delete one saved version for good. Waits for a restore or import that is reading it, and a pinned one stays.
    public async Task<DeleteVersionResult> DeleteAsync(long id, string by, CancellationToken ct)
    {
        await using var tableLock = await locks.TakeAsync(AppLock.Table, ct);
        switch (await collector.RemoveVersionAsync(id, ct))
        {
            case VersionRemoval.NotFound:
                return new DeleteVersionResult.NotFound();
            case VersionRemoval.Pinned:
                return new DeleteVersionResult.Pinned();
        }
        log.LogInformation("{User} deleted saved version {Version}", by, id);
        return new DeleteVersionResult.Deleted(id);
    }

    // Puts the table back the way it was in this version, rows and rules. The current state gets saved first.
    // The rows, the rules version and the developer request go in one transaction behind IHistoryRestoreRunner.
    public async Task<RestoreResult> RestoreAsync(long id, string? note, string by, CancellationToken ct)
    {
        var trimmed = note?.Trim();
        if (trimmed is null || trimmed.Length < 10)
        {
            return new RestoreResult.Invalid(new Dictionary<string, string[]>
            {
                ["note"] = ["Write a few words about why, at least 10 characters"]
            });
        }
        if (trimmed.Length > NoteMax)
        {
            return new RestoreResult.Invalid(new Dictionary<string, string[]>
            {
                ["note"] = [$"Keep it to {NoteMax} characters or fewer"]
            });
        }
        await using var tableLock = await locks.TakeAsync(AppLock.Table, ct);
        await using var rulesLock = await locks.TakeAsync(AppLock.Rules, ct);
        var v = await collector.GetVersionAsync(id, ct);
        if (v is null) return new RestoreResult.NotFound();
        if (v.Summary.Damaged) return new RestoreResult.Damaged();

        var plan = await writer.PlanAsync(v, forRestore: true, ct);

        // Refuse before anything is saved, so a refused restore leaves no copy behind
        if (plan.HasNameClash()) return new RestoreResult.NameClash();

        long? copyId;
        try
        {
            copyId = await collector.SaveVersionAsync($"Before restoring version {id} — {trimmed}", by, ct, applyRetention: false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogError(ex, "Copy before restore failed");
            return new RestoreResult.BackupFailed("the table wasn't restored");
        }

        HistoryRestoreRun run;
        try
        {
            run = await restoreRunner.RunAsync(v, plan, id, by, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // The change didn't happen, so the copy of the unchanged table isn't needed
            if (copyId is long unused) await collector.DeleteVersionAsync(unused);
            throw;
        }

        if (run is HistoryRestoreRun.NameClash)
        {
            if (copyId is long unused) await collector.DeleteVersionAsync(unused);
            return new RestoreResult.NameClash();
        }

        var outcome = (HistoryRestoreRun.Done)run;
        try
        {
            await collector.LogChangeAsync(null, "restore", new { Rows = outcome.RowsBefore },
                new { RestoredFrom = id, Rows = outcome.Restored }, rules.Current.Version, by, "done", ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "Restore went through but the collector log failed");
        }
        await collector.ApplyRetentionQuietlyAsync(id, ct);

        return new RestoreResult.Done(
            outcome.Restored,
            plan.Rows.Where(r => r.Skip is not null).Select(r => r.Skip).ToList(),
            plan.Rows.Count(r => r.Lost.Count > 0),
            outcome.RulesRestored,
            outcome.RequestId);
    }

    // What an import from this version would add, nothing gets written
    public async Task<ImportPreviewResult> PreviewImportAsync(long id, CancellationToken ct)
    {
        await using var tableLock = await locks.TakeAsync(AppLock.Table, ct);
        var v = await collector.GetVersionAsync(id, ct);
        if (v is null) return new ImportPreviewResult.NotFound();
        if (v.Summary.Damaged) return new ImportPreviewResult.Damaged();
        var plan = await writer.PlanAsync(v, forRestore: false, ct);
        return new ImportPreviewResult.Preview(new ImportPreview(
            plan.VersionId,
            plan.RulesDiffer,
            plan.RulesDiffer ? RulesDifferMessage : null,
            plan.UnmatchedColumns,
            plan.Rows.Count,
            plan.Rows.Count(r => r.Skip is null),
            // Rows already in the table that an earlier import took from this very version, so the page can say so
            await writer.CountImportedFromAsync(id, ct),
            plan.Rows.Where(r => r.Skip is not null).Select(r => r.Skip).ToList(),
            plan.Rows.Select(r => new ImportPreviewRow(
                r.OldId,
                r.Name,
                r.Values,
                Level(r),
                r.Problems.Select(p => p.Text).ToList(),
                r.SimilarTo,
                r.SimilarInBatch,
                r.Skip)).ToList()));
    }

    // Adds the version's rows as new rows with new ids. Nothing gets replaced.
    public async Task<ImportResult> ImportAsync(long id, bool confirm, bool? skipDuplicates, string by, CancellationToken ct)
    {
        await using var tableLock = await locks.TakeAsync(AppLock.Table, ct);
        var v = await collector.GetVersionAsync(id, ct);
        if (v is null) return new ImportResult.NotFound();
        if (v.Summary.Damaged) return new ImportResult.Damaged();
        var plan = await writer.PlanAsync(v, forRestore: false, ct);
        if (plan.RulesDiffer && !confirm)
        {
            return new ImportResult.NeedsConfirm();
        }

        // Rows whose name is already in the table come in as flagged copies. That is allowed, but never by default:
        // the caller has to say skip or keep, so an empty or older call can't add the whole version a second time.
        // Nothing is written and no copy of the table is saved when this answers.
        var duplicateRows = plan.Rows.Count(r => r.Skip is null && (r.SimilarTo is not null || r.SimilarInBatch));
        if (duplicateRows > 0 && skipDuplicates is null)
        {
            var total = plan.Rows.Count(r => r.Skip is null);
            var already = await writer.CountImportedFromAsync(id, ct);
            var text = string.Create(CultureInfo.InvariantCulture,
                $"{duplicateRows:N0} of {total:N0} rows have a name that is already in the table. Choose whether to leave them out or add them as flagged copies.");
            if (already > 0)
            {
                text += string.Create(CultureInfo.InvariantCulture, $" {already:N0} rows were already brought back from this version.");
            }
            return new ImportResult.NeedsDecision(duplicateRows, total, already, text);
        }

        // Rows already in the table get skipped like nameless rows, so the import only adds new names
        var leftOut = 0;
        if (skipDuplicates == true)
        {
            plan = plan with
            {
                Rows = plan.Rows.Select(r =>
                {
                    if (r.Skip is not null || (r.SimilarTo is null && !r.SimilarInBatch)) return r;
                    leftOut++;
                    return r with { Skip = "" };
                }).ToList()
            };
            if (!plan.Rows.Any(r => r.Skip is null))
            {
                return new ImportResult.NothingNew();
            }
        }

        long? copyId;
        try
        {
            copyId = await collector.SaveVersionAsync($"Before importing from version {id}", by, ct, applyRetention: false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogError(ex, "Copy before import failed");
            return new ImportResult.BackupFailed("nothing was imported");
        }

        List<(PlannedRow Row, int NewId, JsonElement Snapshot)> added;
        try
        {
            added = await writer.ImportAsync(plan, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Nothing was imported, so the copy of the unchanged table isn't needed
            if (copyId is long unused) await collector.DeleteVersionAsync(unused);
            throw;
        }
        try
        {
            await collector.LogImportsAsync(added.Select(a => (a.NewId, (object)a.Snapshot)),
                rules.Current.Version, by, ct);
        }
        catch (Exception ex)
        {
            log.LogWarning(ex, "Import went through but the collector log failed");
        }

        var requestIds = new List<int>();
        foreach (var column in plan.UnmatchedColumns)
        {
            var request = await requests.CreateAsync("rename", $"Old column \"{column}\" has no place in today's table",
                $"Version #{id} has a column \"{column}\" that today's table doesn't have. If it was renamed, a developer can point it to the new column so imports bring its values over.",
                Drafts.RenamedColumn(column, id), by, ct: ct);
            requestIds.Add(request.Request.Id);
        }
        await collector.ApplyRetentionQuietlyAsync(id, ct);

        return new ImportResult.Imported(
            added.Count,
            added.Count(a => a.Row.SimilarTo is not null || a.Row.SimilarInBatch),
            added.Count(a => a.Row.Lost.Count > 0),
            added.Count(a => a.Row.Problems.Any(p => p.Level == "black" && !p.Text.StartsWith("A similar row"))),
            // Left out duplicates are counted, not listed one by one
            plan.Rows.Where(r => !string.IsNullOrEmpty(r.Skip)).Select(r => r.Skip).ToList(),
            leftOut,
            requestIds);
    }

    // How many saved versions these settings would remove, nothing is saved or deleted
    public async Task<RetentionPreviewResult> PreviewRetentionAsync(Retention body, CancellationToken ct)
    {
        var errors = SettingsService.Check(body);
        if (errors.Count > 0) return new RetentionPreviewResult.Invalid(errors);
        return new RetentionPreviewResult.Preview(await collector.CountRemovableAsync(body, 0, ct));
    }

    public async Task<RetentionSaveResult> SaveRetentionAsync(Retention body, string by, CancellationToken ct)
    {
        await using var settingsLock = await locks.TakeAsync(AppLock.Settings, ct);
        var errors = SettingsService.Check(body);
        if (errors.Count > 0) return new RetentionSaveResult.Invalid(errors);
        await settings.SaveRetentionAsync(settingsStore, body, by, ct);
        try
        {
            var removed = await collector.ApplyRetentionAsync(ct);
            return new RetentionSaveResult.Saved(body.KeepVersions, body.KeepDays, removed, null);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "Retention was saved but old versions weren't removed");
            return new RetentionSaveResult.Saved(body.KeepVersions, body.KeepDays, null,
                "Saved. Old versions will be removed the next time history is reachable");
        }
    }

    private static string? Level(PlannedRow r) =>
        r.Problems.Any(p => p.Level == "red") ? "red" : r.Problems.Count > 0 ? "black" : null;

    private static string CellText(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Null => "",
        JsonValueKind.String => CsvText.GuardFormula(value.GetString()!),
        _ => value.GetRawText()
    };
}
