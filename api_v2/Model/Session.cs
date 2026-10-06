namespace api_v2.Model;

// One sign in. The page keeps the token, only its SHA-256 is stored here, so a copy of the database has no working tokens.
public class Session
{
    public long Id { get; set; }
    public int UserId { get; set; }
    public User? User { get; set; }
    public required byte[] TokenHash { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset LastSeenAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
}
