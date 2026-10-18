using System.Globalization;
using api_v2.Application.Auth;
using api_v2.Application.Ports;
using api_v2.Domain.Entities;
using api_v2.Domain.Rules;

namespace api_v2.Application.Requests;

// Requests for a developer, their conversations and their statuses. The same open request never gets made twice,
// so an import that runs 5 times still shows one request.
public class RequestService(IRequestsStore store, IAppLocks locks, RulesService rules)
{
    // The most code one person can attach to a request
    public const int MaxCodeLength = 20000;

    // status is open (default), in-progress, done, dismissed, active (open or in-progress) or all
    public Task<IReadOnlyList<RequestListItem>> ListAsync(string? status, CancellationToken ct) =>
        store.ListAsync(status ?? "open", ct);

    public async Task<GetRequestResult> GetAsync(int id, CancellationToken ct)
    {
        var (request, messages) = await store.GetAsync(id, ct);
        return request is null
            ? new GetRequestResult.NotFound()
            : new GetRequestResult.Found(request, messages);
    }

    public async Task<int> CountActiveAsync(CancellationToken ct) => await store.CountActiveAsync(ct);

    // The person who asked and the admins talk here. Anyone else can read it but not write.
    public async Task<AddMessageResult> AddMessageAsync(int id, string? body, ICurrentUser user, CancellationToken ct)
    {
        var text = body?.Trim() ?? "";
        if (text.Length == 0 || text.Length > 2000)
        {
            return new AddMessageResult.Invalid(new Dictionary<string, string[]>
            {
                ["body"] = ["Write a message of 1 to 2000 characters"]
            });
        }

        await using var requestsLock = await locks.TakeAsync(AppLock.Requests, ct);
        var request = await store.FindAsync(id, ct);
        if (request is null) return new AddMessageResult.NotFound();
        var isAsker = string.Equals(request.CreatedBy, user.Name, StringComparison.Ordinal);
        if (!user.IsAdmin && !isAsker) return new AddMessageResult.Forbidden();

        var message = new RequestMessage
        {
            RequestId = id,
            CreatedAt = DateTimeOffset.UtcNow,
            Author = user.Name,
            FromDeveloper = user.IsAdmin,
            Body = text
        };
        store.AddMessage(message);
        // A developer answering means someone picked it up
        if (user.IsAdmin && request.Status == "open") request.Status = "in-progress";
        await store.SaveAsync(ct);
        return new AddMessageResult.Added(message, request.Status);
    }

    // Anything else the team needs a developer for
    public async Task<AskRequestResult> AskAsync(string? title, string? details, string? code, ICurrentUser user, CancellationToken ct)
    {
        var errors = new Dictionary<string, string[]>();
        if (string.IsNullOrWhiteSpace(title) || title.Trim().Length > 120) errors["title"] = ["Say what you need in 1 to 120 characters"];
        if (details?.Length > 2000) errors["details"] = ["Keep the details under 2000 characters"];
        if (code?.Length > MaxCodeLength) errors["code"] = [$"Keep the code under {MaxCodeLength} characters"];
        if (errors.Count > 0) return new AskRequestResult.Invalid(errors);

        var drafted = string.IsNullOrWhiteSpace(code) ? null : code.Trim('\r', '\n').TrimEnd();
        var request = await CreateAsync("other", title!.Trim(), details?.Trim() ?? "", drafted, user.Name, null, ct);
        return request.Created
            ? new AskRequestResult.Created(request.Request)
            : new AskRequestResult.Existing(request.Request);
    }

    // A real column, or turning a custom field into one. Comes with the C# drafted.
    public async Task<AskRequestResult> ColumnAsync(
        string? label, string? type, string? fieldKey, string? details, ICurrentUser user, CancellationToken ct)
    {
        var field = fieldKey is null ? null : rules.Current.Fields.FirstOrDefault(f => f.Key == fieldKey && f.Custom);
        var cleanLabel = field?.Label ?? label?.Trim();
        var cleanType = field?.Type ?? type;
        if (field is null && cleanLabel is not null && Names.HasHiddenCharacters(cleanLabel))
        {
            return new AskRequestResult.Invalid(new Dictionary<string, string[]>
            {
                ["label"] = ["The label can't contain line breaks or hidden characters"]
            });
        }
        if (string.IsNullOrWhiteSpace(cleanLabel) || cleanLabel.Length > 40 || cleanType is not ("text" or "number" or "date"))
        {
            return new AskRequestResult.Invalid(new Dictionary<string, string[]>
            {
                ["column"] = ["Give the column a name (up to 40 characters) and a type: text, number or date"]
            });
        }

        var title = field is null ? $"Add a real column \"{cleanLabel}\"" : $"Turn \"{cleanLabel}\" into a real column";
        var asked = (details?.Trim() is { Length: > 0 } d ? d + "\n\n" : "") +
            $"A {cleanType} column called \"{cleanLabel}\" in the Industries table." +
            (field is null ? "" : $" Its values are in the custom field \"{field.Key}\" today, move them over once the column exists.");
        var request = await CreateAsync("column", title, asked, Drafts.NewColumn(cleanLabel, cleanType!), user.Name, field?.Key, ct);
        return request.Created
            ? new AskRequestResult.Created(request.Request)
            : new AskRequestResult.Existing(request.Request);
    }

    // Changing a custom field's type needs its values converted, so a developer does it
    public async Task<AskRequestResult> FieldTypeAsync(string? fieldKey, string? type, ICurrentUser user, CancellationToken ct)
    {
        var field = fieldKey is null ? null : rules.Current.Fields.FirstOrDefault(f => f.Key == fieldKey && f.Custom);
        if (field is null || type is not ("text" or "number" or "date") || type == field.Type)
        {
            return new AskRequestResult.Invalid(new Dictionary<string, string[]>
            {
                ["type"] = ["Pick a custom field and a different type: text, number or date"]
            });
        }
        var request = await CreateAsync("field-type", $"Change \"{field.Label}\" from {field.Type} to {type}",
            $"The team wants \"{field.Label}\" to be a {type} instead of {field.Type}. Values that don't fit the new type will show as --.",
            Drafts.FieldType(field.Key, field.Label, field.Type, type), user.Name, field.Key, ct);
        return request.Created
            ? new AskRequestResult.Created(request.Request)
            : new AskRequestResult.Existing(request.Request);
    }

    // Developers mark requests done or dismissed, open brings one back
    public async Task<SetStatusResult> SetStatusAsync(int id, string? status, ICurrentUser user, CancellationToken ct)
    {
        await using var requestsLock = await locks.TakeAsync(AppLock.Requests, ct);
        if (status is not ("open" or "in-progress" or "done" or "dismissed"))
        {
            return new SetStatusResult.Invalid(new Dictionary<string, string[]>
            {
                ["status"] = ["Status has to be open, in-progress, done or dismissed"]
            });
        }
        var request = await store.FindAsync(id, ct);
        if (request is null) return new SetStatusResult.NotFound();
        if (status == "open")
        {
            var title = request.Title.ToLower();
            var other = await store.FindOtherOpenAsync(id, request.Kind, request.FieldKey, title, ct);
            if (other is not null)
            {
                return new SetStatusResult.Conflict(other.Id);
            }
        }
        request.Status = status;
        var finished = status is "done" or "dismissed";
        request.ResolvedAt = finished ? DateTimeOffset.UtcNow : null;
        request.ResolvedBy = finished ? user.Name : null;
        await store.SaveAsync(ct);
        return new SetStatusResult.Updated(request);
    }

    // Makes a request, or adds this person's details to the one already open with the same kind, field and title
    public async Task<(DevRequest Request, bool Created)> CreateAsync(string kind, string title, string details,
        string? draftedCode, string createdBy, string? fieldKey = null, CancellationToken ct = default)
    {
        await using var requestsLock = await locks.TakeAsync(AppLock.Requests, ct);
        var open = await store.FindOpenAsync(kind, fieldKey, title.ToLower(), ct);
        if (open is not null)
        {
            if (!string.IsNullOrWhiteSpace(details) && !open.Details.Contains(details) && open.Details.Length <= 8000)
            {
                var when = DateTimeOffset.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
                open.Details = $"{open.Details}\n\nAlso asked by {createdBy} on {when}:\n{details}";
                await store.SaveAsync(ct);
            }
            // Code someone drafts for a request that already exists is kept next to what was drafted before
            if (!string.IsNullOrWhiteSpace(draftedCode) && open.DraftedCode?.Contains(draftedCode) != true)
            {
                if (string.IsNullOrWhiteSpace(open.DraftedCode)) open.DraftedCode = draftedCode;
                else if (open.DraftedCode.Length <= MaxCodeLength)
                {
                    open.DraftedCode = $"{open.DraftedCode}\n\n// Also drafted by {createdBy}\n{draftedCode}";
                }
                await store.SaveAsync(ct);
            }
            return (open, false);
        }

        var request = new DevRequest
        {
            CreatedAt = DateTimeOffset.UtcNow,
            Kind = kind,
            Title = title,
            Details = details,
            DraftedCode = draftedCode,
            Status = "open",
            CreatedBy = createdBy,
            FieldKey = fieldKey
        };
        store.AddRequest(request);
        await store.SaveAsync(ct);
        return (request, true);
    }
}
