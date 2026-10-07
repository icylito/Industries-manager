namespace api_v2.Model;

// A person who can sign in. An account can be turned off or deleted; History keeps the name either way.
public class User
{
    public int Id { get; set; }
    // Stored trimmed and lowercase, letters, digits, dot, underscore and dash
    public required string Username { get; set; }
    // pbkdf2-sha256$iterations$salt$hash, see Auth/PasswordHasher.cs
    public required string PasswordHash { get; set; }
    // admin or normal
    public required string Role { get; set; }
    public bool Disabled { get; set; }
    // Set for a new account or after a reset, the person has to pick their own password first
    public bool MustChangePassword { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public required string CreatedBy { get; set; }
    public DateTimeOffset? PasswordChangedAt { get; set; }
    public DateTimeOffset? LastLoginAt { get; set; }
}
