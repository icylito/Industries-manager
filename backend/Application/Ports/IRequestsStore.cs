using api_v2.Domain.Entities;

namespace api_v2.Application.Ports;

// One row of the requests list, with the number of replies the page shows
public record RequestListItem(int Id, DateTimeOffset CreatedAt, string Kind, string Title, string Details,
    string? DraftedCode, string Status, string CreatedBy, string? FieldKey, DateTimeOffset? ResolvedAt,
    string? ResolvedBy, int Replies);

// Requests for a developer and their conversations
public interface IRequestsStore
{
    Task<IReadOnlyList<RequestListItem>> ListAsync(string status, CancellationToken ct);

    Task<(DevRequest? Request, IReadOnlyList<RequestMessage> Messages)> GetAsync(int id, CancellationToken ct);

    // Tracked, because messages and statuses change the request they read
    Task<DevRequest?> FindAsync(int id, CancellationToken ct);

    // The request with the same kind, field and title that is still open, if there is one
    Task<DevRequest?> FindOpenAsync(string kind, string? fieldKey, string titleLower, CancellationToken ct);

    // The same, for another request that is being reopened
    Task<DevRequest?> FindOtherOpenAsync(int id, string kind, string? fieldKey, string titleLower, CancellationToken ct);

    void AddRequest(DevRequest request);

    void AddMessage(RequestMessage message);

    Task SaveAsync(CancellationToken ct);

    Task<int> CountActiveAsync(CancellationToken ct);
}
