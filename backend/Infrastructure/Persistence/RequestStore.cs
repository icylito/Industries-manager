using api_v2.Application.Ports;
using api_v2.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace api_v2.Infrastructure.Persistence;

// Requests and their conversations, through EF
public class RequestStore(AppDbContext db) : IRequestsStore
{
    public async Task<IReadOnlyList<RequestListItem>> ListAsync(string status, CancellationToken ct)
    {
        var query = db.Requests.AsNoTracking();
        if (status == "active") query = query.Where(r => r.Status == "open" || r.Status == "in-progress");
        else if (status != "all") query = query.Where(r => r.Status == status);
        return await query.OrderByDescending(r => r.Id).Select(r => new RequestListItem(
            r.Id, r.CreatedAt, r.Kind, r.Title, r.Details, r.DraftedCode, r.Status, r.CreatedBy, r.FieldKey,
            r.ResolvedAt, r.ResolvedBy,
            db.RequestMessages.Count(m => m.RequestId == r.Id))).ToListAsync(ct);
    }

    public async Task<(DevRequest? Request, IReadOnlyList<RequestMessage> Messages)> GetAsync(int id, CancellationToken ct)
    {
        var request = await db.Requests.AsNoTracking().FirstOrDefaultAsync(r => r.Id == id, ct);
        var messages = await db.RequestMessages.AsNoTracking()
            .Where(m => m.RequestId == id).OrderBy(m => m.Id).ToListAsync(ct);
        return (request, messages);
    }

    public async Task<DevRequest?> FindAsync(int id, CancellationToken ct) => await db.Requests.FindAsync([id], ct);

    public Task<DevRequest?> FindOpenAsync(string kind, string? fieldKey, string titleLower, CancellationToken ct) =>
        db.Requests.FirstOrDefaultAsync(
            r => (r.Status == "open" || r.Status == "in-progress") && r.Kind == kind
                 && r.FieldKey == fieldKey && r.Title.ToLower() == titleLower, ct);

    public Task<DevRequest?> FindOtherOpenAsync(int id, string kind, string? fieldKey, string titleLower, CancellationToken ct) =>
        db.Requests.FirstOrDefaultAsync(
            r => r.Id != id && r.Status == "open" && r.Kind == kind
                 && r.FieldKey == fieldKey && r.Title.ToLower() == titleLower, ct);

    public void AddRequest(DevRequest request) => db.Requests.Add(request);

    public void AddMessage(RequestMessage message) => db.RequestMessages.Add(message);

    public Task SaveAsync(CancellationToken ct) => db.SaveChangesAsync(ct);

    public Task<int> CountActiveAsync(CancellationToken ct) =>
        db.Requests.CountAsync(r => r.Status == "open" || r.Status == "in-progress", ct);
}
