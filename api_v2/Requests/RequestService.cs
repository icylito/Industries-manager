using System.Globalization;
using api_v2.Data;
using api_v2.Model;
using Microsoft.EntityFrameworkCore;

namespace api_v2.Requests;

// Makes requests for a developer. The same open request never gets made twice,
// so an import that runs 5 times still shows one request.
public static class RequestService
{
    // The most code one person can attach to a request, checked by the endpoint that takes it
    public const int MaxCodeLength = 20000;

    public static async Task<(DevRequest Request, bool Created)> CreateAsync(AppDbContext db, AppLocks locks, string kind, string title, string details,
        string? draftedCode, string createdBy, string? fieldKey = null, CancellationToken ct = default)
    {
        await using var requestsLock = await locks.TakeAsync(AppLock.Requests, ct);
        var open = await db.Requests.FirstOrDefaultAsync(
            r => (r.Status == "open" || r.Status == "in-progress") && r.Kind == kind && r.FieldKey == fieldKey && r.Title.ToLower() == title.ToLower(), ct);
        if (open is not null)
        {
            if (!string.IsNullOrWhiteSpace(details) && !open.Details.Contains(details) && open.Details.Length <= 8000)
            {
                var when = DateTimeOffset.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
                open.Details = $"{open.Details}\n\nAlso asked by {createdBy} on {when}:\n{details}";
                await db.SaveChangesAsync(ct);
            }
            // Code someone drafts for a request that already exists is kept next to what was drafted before
            if (!string.IsNullOrWhiteSpace(draftedCode) && open.DraftedCode?.Contains(draftedCode) != true)
            {
                if (string.IsNullOrWhiteSpace(open.DraftedCode)) open.DraftedCode = draftedCode;
                else if (open.DraftedCode.Length <= MaxCodeLength)
                {
                    open.DraftedCode = $"{open.DraftedCode}\n\n// Also drafted by {createdBy}\n{draftedCode}";
                }
                await db.SaveChangesAsync(ct);
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
        db.Requests.Add(request);
        await db.SaveChangesAsync(ct);
        return (request, true);
    }
}
