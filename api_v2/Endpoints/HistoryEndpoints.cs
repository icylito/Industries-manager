using System.Text;
using System.Text.Json;
using api_v2.Auth;
using api_v2.Data;
using api_v2.History;
using api_v2.Requests;
using api_v2.Rules;
using Npgsql;

namespace api_v2.Endpoints;

public record PinBody(bool Pinned);
public record RestoreBody(string? Confirm);
public record ImportBody(bool Confirm);

public static class HistoryEndpoints
{
    // The message the page shows before importing data saved under other rules
    public const string RulesDifferMessage = "The old data follows different rules than the table does now. Import it anyway?";

    public static void MapHistory(this WebApplication app)
    {
        var history = app.MapGroup("/history").RequireDatabaseReady().RequireAdmin();
        history.AddEndpointFilter(async (context, next) =>
        {
            var status = context.HttpContext.RequestServices.GetRequiredService<DatabaseStatus>();
            if (!status.HistoryReady)
            {
                return Results.Problem(
                    "History isn't available right now, nothing was changed. Try again in a moment",
                    statusCode: StatusCodes.Status503ServiceUnavailable, title: "History not available");
            }
            try
            {
                return await next(context);
            }
            catch (Exception ex) when (HistoryDown(ex))
            {
                var log = context.HttpContext.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger(nameof(HistoryEndpoints));
                log.LogError(ex, "History database failed");
                return Results.Problem(
                    "History isn't available right now, nothing was changed. Try again in a moment",
                    statusCode: StatusCodes.Status503ServiceUnavailable, title: "History not available");
            }
        });

        // Saved versions, newest first. SameLayout says if the table looked the same back then.
        history.MapGet("/versions", async (CollectorStore collector, DatabaseStatus status, CancellationToken ct) =>
        {
            var current = status.AppliedMigrations.ToHashSet();
            var versions = await collector.ListVersionsAsync(ct);
            return Results.Ok(versions.Select(v => new
            {
                v.Id, v.CreatedAt, v.Reason, v.CreatedBy, v.RowCount, v.RulesVersion, v.Pinned,
                SameLayout = current.SetEquals(v.Migrations)
            }));
        });

        // One version with its rows, for View
        history.MapGet("/versions/{id:long}", async (long id, CollectorStore collector, DatabaseStatus status, CancellationToken ct) =>
        {
            var v = await collector.GetVersionAsync(id, ct);
            if (v is null) return NotFound(id);
            return Results.Ok(new
            {
                v.Summary.Id, v.Summary.CreatedAt, v.Summary.Reason, v.Summary.CreatedBy, v.Summary.RowCount,
                v.Summary.RulesVersion, v.Summary.Pinned,
                SameLayout = status.AppliedMigrations.ToHashSet().SetEquals(v.Summary.Migrations),
                Columns = v.Columns.Select(c => c.Name),
                Rules = v.Rules is null ? null : RulesService.ParseFields(v.Rules),
                v.Rows
            });
        });

        // A version as a CSV file, opens in Excel
        history.MapGet("/versions/{id:long}/download", async (long id, CollectorStore collector, CancellationToken ct) =>
        {
            var v = await collector.GetVersionAsync(id, ct);
            if (v is null) return NotFound(id);
            var columns = v.Columns.Select(c => c.Name).ToList();
            var csv = new StringBuilder();
            csv.AppendLine(string.Join(",", columns.Select(Csv)));
            foreach (var row in v.Rows)
            {
                csv.AppendLine(string.Join(",", columns.Select(c =>
                    row.TryGetProperty(c, out var value) ? Csv(CellText(value)) : "")));
            }
            var bytes = Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(csv.ToString())).ToArray();
            return Results.File(bytes, "text/csv", $"version-{id}-{v.Summary.CreatedAt:yyyy-MM-dd}.csv");
        });

        // Pinned versions never get removed by retention
        history.MapPut("/versions/{id:long}/pin", async (long id, PinBody body, CollectorStore collector, CancellationToken ct) =>
            await collector.SetPinnedAsync(id, body.Pinned, ct) ? Results.NoContent() : NotFound(id));

        // Puts the table back the way it was in this version, rows and rules. The current state gets saved first.
        history.MapPost("/versions/{id:long}/restore", async (long id, RestoreBody body, CollectorStore collector,
            TableWriter writer, RulesService rules, AppDbContext db, DatabaseStatus status, ICurrentUser user,
            ILogger<TableWriter> log, AppLocks locks, CancellationToken ct) =>
        {
            if (body.Confirm != "RESTORE")
            {
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["confirm"] = ["Type RESTORE to confirm"] });
            }
            await using var tableLock = await locks.TakeAsync(AppLock.Table, ct);
            await using var rulesLock = await locks.TakeAsync(AppLock.Rules, ct);
            var v = await collector.GetVersionAsync(id, ct);
            if (v is null) return NotFound(id);

            var plan = await writer.PlanAsync(v, forRestore: true, ct);
            try
            {
                await collector.SaveVersionAsync($"Before restoring version {id}", user.Name, ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogError(ex, "Copy before restore failed");
                return BackupFailed("the table wasn't restored");
            }

            int restored;
            try
            {
                restored = await writer.RestoreAsync(plan, ct);
            }
            catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.UniqueViolation)
            {
                return Results.Conflict("Two rows in that version have the same name, so it can't be restored as it was. Nothing was changed. Try Import instead");
            }

            var rulesRestored = false;
            if (v.Rules is not null && rules.Differs(v.Rules))
            {
                await rules.SaveAsync(db, RulesService.ParseFields(v.Rules), $"Restored from version {id}", user.Name, ct, copyFirst: false);
                rulesRestored = true;
            }

            int? requestId = null;
            var current = status.AppliedMigrations.ToList();
            if (!current.ToHashSet().SetEquals(v.Summary.Migrations))
            {
                var request = await RequestService.CreateAsync(db, locks, "restore-layout",
                    $"Bring back the table layout of version #{id}",
                    $"Version #{id} was restored, but the table looked different back then. Its rows were fitted into today's layout. A developer is needed to bring the old layout back.",
                    Drafts.RestoreLayout(id, v.Summary.Migrations.Except(current), current.Except(v.Summary.Migrations)),
                    user.Name, ct: ct);
                requestId = request.Request.Id;
            }

            return Results.Ok(new
            {
                Restored = restored,
                Skipped = plan.Rows.Where(r => r.Skip is not null).Select(r => r.Skip),
                LostValues = plan.Rows.Count(r => r.Lost.Count > 0),
                RulesRestored = rulesRestored,
                RequestId = requestId
            });
        });

        // What an import from this version would add, nothing gets written
        history.MapPost("/versions/{id:long}/import/preview", async (long id, CollectorStore collector, TableWriter writer,
            AppLocks locks, CancellationToken ct) =>
        {
            await using var tableLock = await locks.TakeAsync(AppLock.Table, ct);
            var v = await collector.GetVersionAsync(id, ct);
            if (v is null) return NotFound(id);
            var plan = await writer.PlanAsync(v, forRestore: false, ct);
            return Results.Ok(new
            {
                plan.VersionId,
                plan.RulesDiffer,
                Message = plan.RulesDiffer ? RulesDifferMessage : null,
                plan.UnmatchedColumns,
                Total = plan.Rows.Count,
                WillImport = plan.Rows.Count(r => r.Skip is null),
                Skipped = plan.Rows.Where(r => r.Skip is not null).Select(r => r.Skip),
                Rows = plan.Rows.Select(r => new
                {
                    r.OldId,
                    r.Name,
                    r.Values,
                    Level = Level(r),
                    Problems = r.Problems.Select(p => p.Text),
                    r.SimilarTo,
                    r.Skip
                })
            });
        });

        // Adds the version's rows as new rows with new ids. Nothing gets replaced.
        history.MapPost("/versions/{id:long}/import", async (long id, ImportBody body, CollectorStore collector,
            TableWriter writer, RulesService rules, AppDbContext db, ICurrentUser user, ILogger<TableWriter> log,
            AppLocks locks, CancellationToken ct) =>
        {
            await using var tableLock = await locks.TakeAsync(AppLock.Table, ct);
            var v = await collector.GetVersionAsync(id, ct);
            if (v is null) return NotFound(id);
            var plan = await writer.PlanAsync(v, forRestore: false, ct);
            if (plan.RulesDiffer && !body.Confirm)
            {
                return Results.Conflict(new { NeedsConfirm = true, Message = RulesDifferMessage });
            }

            try
            {
                await collector.SaveVersionAsync($"Before importing from version {id}", user.Name, ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogError(ex, "Copy before import failed");
                return BackupFailed("nothing was imported");
            }

            var added = await writer.ImportAsync(plan, ct);
            try
            {
                await collector.LogImportsAsync(added.Select(a => (a.NewId, (object)new { Id = a.NewId, a.Row.Name, ImportedFrom = id })),
                    rules.Current.Version, user.Name, ct);
            }
            catch (Exception ex)
            {
                log.LogWarning(ex, "Import went through but the collector log failed");
            }

            var requests = new List<int>();
            foreach (var column in plan.UnmatchedColumns)
            {
                var request = await RequestService.CreateAsync(db, locks, "rename", $"Old column \"{column}\" has no place in today's table",
                    $"Version #{id} has a column \"{column}\" that today's table doesn't have. If it was renamed, a developer can point it to the new column so imports bring its values over.",
                    Drafts.RenamedColumn(column, id), user.Name, ct: ct);
                requests.Add(request.Request.Id);
            }

            return Results.Ok(new
            {
                Imported = added.Count,
                Similar = added.Count(a => a.Row.SimilarTo is not null || a.Row.SimilarInBatch),
                LostValues = added.Count(a => a.Row.Lost.Count > 0),
                BreakingRules = added.Count(a => a.Row.Problems.Any(p => p.Level == "black" && !p.Text.StartsWith("A similar row"))),
                Skipped = plan.Rows.Where(r => r.Skip is not null).Select(r => r.Skip),
                RequestIds = requests
            });
        });

        history.MapGet("/settings", (SettingsService settings) => Results.Ok(settings.Retention));

        history.MapPut("/settings", async (Retention body, SettingsService settings, CollectorStore collector,
            AppDbContext db, ICurrentUser user, AppLocks locks, ILogger<SettingsService> log, CancellationToken ct) =>
        {
            await using var settingsLock = await locks.TakeAsync(AppLock.Settings, ct);
            var errors = SettingsService.Check(body);
            if (errors.Count > 0) return Results.ValidationProblem(errors);
            await settings.SaveRetentionAsync(db, body, user.Name, ct);
            try
            {
                var removed = await collector.ApplyRetentionAsync(ct);
                return Results.Ok(new { body.KeepVersions, body.KeepDays, Removed = (int?)removed, Note = (string?)null });
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogWarning(ex, "Retention was saved but old versions weren't removed");
                return Results.Ok(new
                {
                    body.KeepVersions,
                    body.KeepDays,
                    Removed = (int?)null,
                    Note = "Saved. Old versions will be removed the next time history is reachable"
                });
            }
        });
    }

    // The collector being down, or its tables not existing yet, is one answer for every history route
    private static bool HistoryDown(Exception ex)
    {
        for (var current = ex; current is not null; current = current.InnerException)
        {
            if (current is PostgresException { SqlState: PostgresErrorCodes.UndefinedTable }) return true;
            if (current is NpgsqlException and not PostgresException) return true;
        }
        return false;
    }

    private static string? Level(PlannedRow r) =>
        r.Problems.Any(p => p.Level == "red") ? "red" : r.Problems.Count > 0 ? "black" : null;

    private static IResult NotFound(long id) => Results.NotFound($"There's no saved version #{id}");

    private static IResult BackupFailed(string what) => Results.Problem(
        $"Couldn't save a copy of the table first, so {what}. Try again in a moment",
        statusCode: StatusCodes.Status503ServiceUnavailable, title: "Backup not available");

    private static string CellText(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Null => "",
        JsonValueKind.String => GuardFormula(value.GetString()!),
        _ => value.GetRawText()
    };

    // A leading quote stops Excel treating the cell as a formula. Numbers stay numbers.
    private static string GuardFormula(string text) =>
        text.Length > 0 && text[0] is '=' or '+' or '-' or '@' or '\t' or '\r' ? "'" + text : text;

    private static string Csv(string text) =>
        text.IndexOfAny([',', '"', '\n', '\r']) >= 0 ? $"\"{text.Replace("\"", "\"\"")}\"" : text;
}
