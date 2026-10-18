using System.Globalization;
using System.Text;
using System.Text.Json;
using api_v2.Application.Auth;
using api_v2.Infrastructure.Security;
using api_v2.Application.Health;
using api_v2.Application.Hosted;
using api_v2.Application.Settings;
using api_v2.Application.Startup;
using api_v2.Infrastructure.Configuration;
using api_v2.Infrastructure.Export;
using api_v2.Infrastructure.Files;
using api_v2.Infrastructure.Persistence;
using api_v2.Application.History;
using api_v2.Application.Requests;
using api_v2.Domain.Rules;
using api_v2.Presentation.Contracts;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;
using api_v2.Application.Ports;

namespace api_v2.Presentation.Endpoints;

public static class HistoryEndpoints
{
    // The longest a restore note can be, counted in the same UTF-16 characters the page counts. The page checks the same
    // limit in Components/history/history.ts (noteMax), change both together.
    public const int NoteMax = 300;

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
                context.HttpContext.RequestServices.GetRequiredService<CollectorStore>().NoteFailure(ex);
                return Results.Problem(
                    "History isn't available right now, nothing was changed. Try again in a moment",
                    statusCode: StatusCodes.Status503ServiceUnavailable, title: "History not available");
            }
        });

        // Saved versions, newest first. SameLayout says if the table looked the same back then.
        history.MapGet("/versions", async (CollectorStore collector, DatabaseStatus status, CancellationToken ct) =>
        {
            var versions = await collector.ListVersionsAsync(ct);
            // The reason is clipped here, so one oversized note saved before the limit existed can't slow the page down.
            // One version's own answer (GET /versions/{id}) still carries it whole.
            return Results.Ok(versions.Select(v => new
            {
                v.Id, v.CreatedAt, Reason = CollectorStore.Clip(v.Reason), v.CreatedBy, v.RowCount, v.RulesVersion, v.Pinned, v.Damaged,
                SameLayout = !v.Damaged && status.SameLayout(v.Migrations)
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
                v.Summary.RulesVersion, v.Summary.Pinned, v.Summary.Damaged,
                SameLayout = status.SameLayout(v.Summary.Migrations),
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

        // Delete one saved version for good. Waits for a restore or import that is reading it, and a pinned one stays.
        history.MapDelete("/versions/{id:long}", async (long id, CollectorStore collector, ICurrentUser user,
            ILogger<CollectorStore> log, AppLocks locks, CancellationToken ct) =>
        {
            await using var tableLock = await locks.TakeAsync(AppLock.Table, ct);
            switch (await collector.RemoveVersionAsync(id, ct))
            {
                case VersionRemoval.NotFound:
                    return NotFound(id);
                case VersionRemoval.Pinned:
                    return Results.Conflict($"Version #{id} is pinned. Unpin it first if you want to delete it");
            }
            log.LogInformation("{User} deleted saved version {Version}", user.Name, id);
            return Results.Ok(new { Deleted = id });
        });

        // Puts the table back the way it was in this version, rows and rules. The current state gets saved first.
        history.MapPost("/versions/{id:long}/restore", async (long id, RestoreBody body, CollectorStore collector,
            TableWriter writer, RulesService rules, AppDbContext db, DatabaseStatus status, ICurrentUser user,
            ILogger<TableWriter> log, AppLocks locks, RequestService requestService, CancellationToken ct) =>
        {
            var note = body.Note?.Trim();
            if (note is null || note.Length < 10)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["note"] = ["Write a few words about why, at least 10 characters"] });
            }
            if (note.Length > NoteMax)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["note"] = [$"Keep it to {NoteMax} characters or fewer"] });
            }
            await using var tableLock = await locks.TakeAsync(AppLock.Table, ct);
            await using var rulesLock = await locks.TakeAsync(AppLock.Rules, ct);
            var v = await collector.GetVersionAsync(id, ct);
            if (v is null) return NotFound(id);
            if (v.Summary.Damaged) return Results.Conflict(DamagedMessage);

            var plan = await writer.PlanAsync(v, forRestore: true, ct);

            // Refuse before anything is saved, so a refused restore leaves no copy behind
            if (TableWriter.HasNameClash(plan)) return Results.Conflict(SameNameMessage);

            long? copyId;
            try
            {
                copyId = await collector.SaveVersionAsync($"Before restoring version {id} — {note}", user.Name, ct, applyRetention: false);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogError(ex, "Copy before restore failed");
                return BackupFailed("the table wasn't restored");
            }

            RestoreOutcome outcome;
            try
            {
                outcome = await RestoreInOneStepAsync(v, plan, id, db, writer, rules, status, user, locks, requestService, ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // The change didn't happen, so the copy of the unchanged table isn't needed
                if (copyId is long unused) await collector.DeleteVersionAsync(unused);
                if (ex is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
                {
                    return Results.Conflict(SameNameMessage);
                }
                throw;
            }

            try
            {
                await collector.LogChangeAsync(null, "restore", new { Rows = outcome.RowsBefore },
                    new { RestoredFrom = id, Rows = outcome.Restored }, rules.Current.Version, user.Name, "done", ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogWarning(ex, "Restore went through but the collector log failed");
            }
            await collector.ApplyRetentionQuietlyAsync(id, ct);

            return Results.Ok(new
            {
                outcome.Restored,
                Skipped = plan.Rows.Where(r => r.Skip is not null).Select(r => r.Skip),
                LostValues = plan.Rows.Count(r => r.Lost.Count > 0),
                outcome.RulesRestored,
                outcome.RequestId
            });
        });

        // What an import from this version would add, nothing gets written
        history.MapPost("/versions/{id:long}/import/preview", async (long id, CollectorStore collector, TableWriter writer,
            AppLocks locks, RequestService requestService, CancellationToken ct) =>
        {
            await using var tableLock = await locks.TakeAsync(AppLock.Table, ct);
            var v = await collector.GetVersionAsync(id, ct);
            if (v is null) return NotFound(id);
            if (v.Summary.Damaged) return Results.Conflict(DamagedMessage);
            var plan = await writer.PlanAsync(v, forRestore: false, ct);
            return Results.Ok(new
            {
                plan.VersionId,
                plan.RulesDiffer,
                Message = plan.RulesDiffer ? RulesDifferMessage : null,
                plan.UnmatchedColumns,
                Total = plan.Rows.Count,
                WillImport = plan.Rows.Count(r => r.Skip is null),
                // Rows already in the table that an earlier import took from this very version, so the page can say so
                AlreadyImportedFromThisVersion = await writer.CountImportedFromAsync(id, ct),
                Skipped = plan.Rows.Where(r => r.Skip is not null).Select(r => r.Skip),
                Rows = plan.Rows.Select(r => new
                {
                    r.OldId,
                    r.Name,
                    r.Values,
                    Level = Level(r),
                    Problems = r.Problems.Select(p => p.Text),
                    r.SimilarTo,
                    r.SimilarInBatch,
                    r.Skip
                })
            });
        });

        // Adds the version's rows as new rows with new ids. Nothing gets replaced.
        history.MapPost("/versions/{id:long}/import", async (long id, ImportBody body, CollectorStore collector,
            TableWriter writer, RulesService rules, AppDbContext db, ICurrentUser user, ILogger<TableWriter> log,
            AppLocks locks, RequestService requestService, CancellationToken ct) =>
        {
            await using var tableLock = await locks.TakeAsync(AppLock.Table, ct);
            var v = await collector.GetVersionAsync(id, ct);
            if (v is null) return NotFound(id);
            if (v.Summary.Damaged) return Results.Conflict(DamagedMessage);
            var plan = await writer.PlanAsync(v, forRestore: false, ct);
            if (plan.RulesDiffer && !body.Confirm)
            {
                return Results.Conflict(new { NeedsConfirm = true, Message = RulesDifferMessage });
            }

            // Rows whose name is already in the table come in as flagged copies. That is allowed, but never by default:
            // the caller has to say skip or keep, so an empty or older call can't add the whole version a second time.
            // Nothing is written and no copy of the table is saved when this answers.
            var duplicateRows = plan.Rows.Count(r => r.Skip is null && (r.SimilarTo is not null || r.SimilarInBatch));
            if (duplicateRows > 0 && body.SkipDuplicates is null)
            {
                var total = plan.Rows.Count(r => r.Skip is null);
                var already = await writer.CountImportedFromAsync(id, ct);
                var text = string.Create(CultureInfo.InvariantCulture,
                    $"{duplicateRows:N0} of {total:N0} rows have a name that is already in the table. Choose whether to leave them out or add them as flagged copies.");
                if (already > 0)
                {
                    text += string.Create(CultureInfo.InvariantCulture, $" {already:N0} rows were already brought back from this version.");
                }
                return Results.Conflict(new
                {
                    NeedsDecision = "duplicates",
                    Similar = duplicateRows,
                    Total = total,
                    AlreadyImportedFromThisVersion = already,
                    Message = text
                });
            }

            // Rows already in the table get skipped like nameless rows, so the import only adds new names
            var leftOut = 0;
            if (body.SkipDuplicates == true)
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
                    return Results.Conflict("Every row in that version is already in the table, so there's nothing new to bring back");
                }
            }

            long? copyId;
            try
            {
                copyId = await collector.SaveVersionAsync($"Before importing from version {id}", user.Name, ct, applyRetention: false);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogError(ex, "Copy before import failed");
                return BackupFailed("nothing was imported");
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
                    rules.Current.Version, user.Name, ct);
            }
            catch (Exception ex)
            {
                log.LogWarning(ex, "Import went through but the collector log failed");
            }

            var requests = new List<int>();
            foreach (var column in plan.UnmatchedColumns)
            {
                var request = await requestService.CreateAsync("rename", $"Old column \"{column}\" has no place in today's table",
                    $"Version #{id} has a column \"{column}\" that today's table doesn't have. If it was renamed, a developer can point it to the new column so imports bring its values over.",
                    Drafts.RenamedColumn(column, id), user.Name, ct: ct);
                requests.Add(request.Request.Id);
            }
            await collector.ApplyRetentionQuietlyAsync(id, ct);

            return Results.Ok(new
            {
                Imported = added.Count,
                Similar = added.Count(a => a.Row.SimilarTo is not null || a.Row.SimilarInBatch),
                LostValues = added.Count(a => a.Row.Lost.Count > 0),
                BreakingRules = added.Count(a => a.Row.Problems.Any(p => p.Level == "black" && !p.Text.StartsWith("A similar row"))),
                // Left out duplicates are counted, not listed one by one
                Skipped = plan.Rows.Where(r => !string.IsNullOrEmpty(r.Skip)).Select(r => r.Skip),
                LeftOutDuplicates = leftOut,
                RequestIds = requests
            });
        });

        history.MapSettingsFile();

        history.MapGet("/settings", (SettingsService settings) => Results.Ok(settings.Retention));

        // How many saved versions these settings would remove, nothing is saved or deleted
        history.MapPost("/settings/preview", async (Retention body, CollectorStore collector, CancellationToken ct) =>
        {
            var errors = SettingsService.Check(body);
            if (errors.Count > 0) return Results.ValidationProblem(errors);
            return Results.Ok(new { WillRemove = await collector.CountRemovableAsync(body, 0, ct) });
        });

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

    private const string DamagedMessage = "That saved version is damaged, so it can't be used. Nothing was changed";

    private const string SameNameMessage =
        "Two rows in that version have the same name, so it can't be restored as it was. Nothing was changed. Try Import instead";

    private record RestoreOutcome(int Restored, bool RulesRestored, int? RequestId, int RowsBefore);

    // Rows, rules and the developer request go in together. If any of them fails nothing is kept,
    // and the rules in memory are loaded again so they match the database.
    private static Task<RestoreOutcome> RestoreInOneStepAsync(VersionDetail v, ImportPlan plan, long id, AppDbContext db,
        TableWriter writer, RulesService rules, DatabaseStatus status, ICurrentUser user, AppLocks locks, RequestService requestService, CancellationToken ct)
    {
        var strategy = db.Database.CreateExecutionStrategy();
        return strategy.ExecuteAsync(async () =>
        {
            await using var tx = await db.Database.BeginTransactionAsync(ct);
            try
            {
                var rowsBefore = await db.Industries.CountAsync(ct);
                var restored = await writer.RestoreAsync(plan, (NpgsqlConnection)db.Database.GetDbConnection(),
                    (NpgsqlTransaction)tx.GetDbTransaction(), ct);

                var rulesRestored = false;
                if (v.Rules is not null && rules.Differs(v.Rules))
                {
                    await rules.SaveAsync(db, RulesService.ParseFields(v.Rules), $"Restored from version {id}", user.Name, ct, copyFirst: false);
                    rulesRestored = true;
                }

                int? requestId = null;
                var current = status.AppliedMigrations.ToList();
                var then = status.DataSteps(v.Summary.Migrations);
                if (!status.SameLayout(v.Summary.Migrations))
                {
                    var request = await requestService.CreateAsync("restore-layout",
                        $"Bring back the table layout of version #{id}",
                        $"Version #{id} was restored, but the table looked different back then. Its rows were fitted into today's layout. A developer is needed to bring the old layout back.",
                        Drafts.RestoreLayout(id, then.Except(current), current.Except(then)),
                        user.Name, ct: ct);
                    requestId = request.Request.Id;
                }

                await tx.CommitAsync(ct);
                return new RestoreOutcome(restored, rulesRestored, requestId, rowsBefore);
            }
            catch
            {
                try
                {
                    await tx.RollbackAsync(CancellationToken.None);
                }
                catch
                {
                    // The connection is gone, so the transaction is already rolled back
                }
                db.ChangeTracker.Clear();
                try
                {
                    await rules.LoadAsync(db, CancellationToken.None);
                }
                catch
                {
                    // The next save loads them again
                }
                throw;
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
        JsonValueKind.String => CsvText.GuardFormula(value.GetString()!),
        _ => value.GetRawText()
    };

    private static string Csv(string text) => CsvText.Cell(text);
}
