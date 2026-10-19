namespace api_v2.Domain.Entities;

// A note an admin keeps about an account. The person it is about never sees it: notes are only ever
// served from the admin-only endpoints under /users, never from the shape /auth/me returns.
public class UserNote
{
    public int Id { get; set; }
    public int UserId { get; set; }
    // Plain text, trimmed, capped so a note cannot grow without limit
    public required string Text { get; set; }
    // The admin who wrote it, by username, so an old note still reads right after a rename
    public required string CreatedBy { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}