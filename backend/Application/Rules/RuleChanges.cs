using api_v2.Application.Ports;
using api_v2.Domain.Rules;

namespace api_v2.Application.Rules;

// The answer to one change of the rules. CopyFailed means the copy of the table that every rules version is saved
// with couldn't be made, so nothing changed.
public abstract record RuleChangeResult<T>
{
    public sealed record Done(T Value) : RuleChangeResult<T>;
    public sealed record NoBasedOn : RuleChangeResult<T>;
    public sealed record Stale : RuleChangeResult<T>;
    public sealed record Invalid(Dictionary<string, string[]> Errors) : RuleChangeResult<T>;
    public sealed record Refused(string Message) : RuleChangeResult<T>;
    public sealed record NotFound(string Message) : RuleChangeResult<T>;
    public sealed record CopyFailed : RuleChangeResult<T>;
}

// Every change to the rules from the Fields page: takes the locks in the one order the app uses, reloads the rules,
// checks the version the page was looking at, then saves through RulesAdminService. Without the version two admins
// saving at once would quietly undo each other.
public sealed class RuleChanges(RulesAdminService admin, RulesService rules, IAppLocks locks, ILogger<RulesAdminService> log)
{
    // Saves new rules as the next version, a full copy of the table goes to the collector first
    public async Task<RuleChangeResult<RuleSet>> SaveAsync(SaveRules body, string changedBy, CancellationToken ct)
    {
        await using var rulesLock = await locks.TakeAsync(AppLock.Rules, ct);
        await admin.LoadAsync(ct);
        if (Unchecked(body.BasedOn) is { } refused) return refused;
        var errors = rules.CheckNewRules(body);
        if (errors.Count > 0) return new RuleChangeResult<RuleSet>.Invalid(errors);

        try
        {
            // The page can send options, but only config.toml changes them
            var current = rules.Current.Fields.ToDictionary(f => f.Key);
            var fields = body.Fields.Select(f =>
                current.TryGetValue(f.Key, out var was) ? f with { Options = was.Options } : f).ToList();
            return new RuleChangeResult<RuleSet>.Done(await admin.SaveAsync(fields, body.Note, changedBy, ct));
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogError(ex, "Saving new rules failed");
            return new RuleChangeResult<RuleSet>.CopyFailed();
        }
    }

    // Adds a custom field, its values live in each row's Extra JSON so no C# or migration is needed
    public async Task<RuleChangeResult<RuleSet>> AddFieldAsync(NewField field, string changedBy, CancellationToken ct)
    {
        await using var rulesLock = await locks.TakeAsync(AppLock.Rules, ct);
        await admin.LoadAsync(ct);
        var errors = rules.CheckNewField(field);
        if (errors.Count > 0) return new RuleChangeResult<RuleSet>.Invalid(errors);

        try
        {
            return new RuleChangeResult<RuleSet>.Done(await admin.AddFieldAsync(field, changedBy, ct));
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogError(ex, "Adding a field failed");
            return new RuleChangeResult<RuleSet>.CopyFailed();
        }
    }

    // Several custom fields in one rules version and one table copy
    public async Task<RuleChangeResult<RuleSet>> AddFieldsAsync(NewFields body, string changedBy, CancellationToken ct)
    {
        if (body.Fields is null || body.Fields.Count == 0) return new RuleChangeResult<RuleSet>.Refused("Add at least one field first");

        await using var rulesLock = await locks.TakeAsync(AppLock.Rules, ct);
        await admin.LoadAsync(ct);
        if (Unchecked(body.BasedOn) is { } refused) return refused;
        var errors = rules.CheckNewFields(body.Fields);
        if (errors.Count > 0) return new RuleChangeResult<RuleSet>.Invalid(errors);

        try
        {
            return new RuleChangeResult<RuleSet>.Done(await admin.AddFieldsAsync(body.Fields, changedBy, ct));
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogError(ex, "Adding fields failed");
            return new RuleChangeResult<RuleSet>.CopyFailed();
        }
    }

    // Removes a field the page added. Built in fields stay. A copy of the table is saved first.
    public async Task<RuleChangeResult<FieldDeleted>> DeleteFieldAsync(string key, int? basedOn, string changedBy, CancellationToken ct)
    {
        await using var tableLock = await locks.TakeAsync(AppLock.Table, ct);
        await using var rulesLock = await locks.TakeAsync(AppLock.Rules, ct);
        await admin.LoadAsync(ct);

        var field = rules.Current.Fields.FirstOrDefault(f => f.Key == key);
        if (field is null) return new RuleChangeResult<FieldDeleted>.NotFound($"There's no field {key}");
        if (!field.Custom) return new RuleChangeResult<FieldDeleted>.Refused($"{field.Label} is built in, only a developer can remove it");
        if (basedOn is not int v) return new RuleChangeResult<FieldDeleted>.NoBasedOn();
        if (v != rules.Current.Version) return new RuleChangeResult<FieldDeleted>.Stale();

        try
        {
            return new RuleChangeResult<FieldDeleted>.Done(await admin.DeleteFieldAsync(field.Key, field.Label, changedBy, ct));
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogError(ex, "Copy before deleting a field failed");
            return new RuleChangeResult<FieldDeleted>.CopyFailed();
        }
    }

    private RuleChangeResult<RuleSet>? Unchecked(int? basedOn)
    {
        if (basedOn is not int v) return new RuleChangeResult<RuleSet>.NoBasedOn();
        return v != rules.Current.Version ? new RuleChangeResult<RuleSet>.Stale() : null;
    }
}
