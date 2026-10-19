using api_v2.Domain.Entities;
namespace api_v2.Presentation.Contracts;

public record AskBody(string? Title, string? Details, string? Code = null);
public record ColumnAsk(string? Label, string? Type, string? FieldKey, string? Details);
public record TypeAsk(string? FieldKey, string? Type);
public record StatusBody(string? Status);
public record MessageBody(string? Body);

// A request and one message as the page reads them. Same fields, names and order as the stored rows, so the JSON
// is what it always was, but the wire no longer changes when an entity does.
public record DevRequestView(int Id, DateTimeOffset CreatedAt, string Kind, string Title, string Details, string? DraftedCode,
    string Status, string CreatedBy, string? FieldKey, DateTimeOffset? ResolvedAt, string? ResolvedBy)
{
    public static DevRequestView From(DevRequest r) => new(r.Id, r.CreatedAt, r.Kind, r.Title, r.Details, r.DraftedCode,
        r.Status, r.CreatedBy, r.FieldKey, r.ResolvedAt, r.ResolvedBy);
}

public record RequestMessageView(int Id, int RequestId, DateTimeOffset CreatedAt, string Author, bool FromDeveloper, string Body)
{
    public static RequestMessageView From(RequestMessage m) => new(m.Id, m.RequestId, m.CreatedAt, m.Author, m.FromDeveloper, m.Body);
}
