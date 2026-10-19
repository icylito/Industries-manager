namespace api_v2.Domain.Entities;

// One message in the conversation on a request, between the person who asked and the developers
public class RequestMessage
{
    public int Id { get; set; }
    public int RequestId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public required string Author { get; set; }
    // True when an admin wrote it, so the page can show it as the developer's side
    public bool FromDeveloper { get; set; }
    public required string Body { get; set; }
}
