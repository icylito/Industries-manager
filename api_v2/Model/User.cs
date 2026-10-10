namespace api_v2.Model;

// A person who can sign in. An account can be turned off or deleted; History keeps the name either way.
public class User
{
    public int Id { get; set; }
    // Stored trimmed and lowercase, letters, digits, dot, underscore and dash
    public required string Username { get; set; }
    // pbkdf2-sha256$iterations$salt$hash, see Auth/PasswordHasher.cs
    public required string PasswordHash { get; set; }
    // admin, manager or normal
    public required string Role { get; set; }
    public bool Disabled { get; set; }
    // Set for a new account or after a reset, the person has to pick their own password first
    public bool MustChangePassword { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public required string CreatedBy { get; set; }
    public DateTimeOffset? PasswordChangedAt { get; set; }
    public DateTimeOffset? LastLoginAt { get; set; }
    // The name the person shows, set on their profile card. Null shows the username. Never used to sign in.
    public string? DisplayName { get; set; }
    // When their picture was last set, null without one. The picture itself is in UserAvatars (Model/UserAvatar.cs);
    // the page uses this to know there is one and to fetch it again after a change.
    public DateTimeOffset? AvatarAt { get; set; }
    // Set by OneUsernameRule on an account whose username was the same as an older account's by the one name rule
    // (Rules/Names.cs), for an admin to rename or delete. Sign in is unchanged. Cleared once the clash is gone.
    public bool NameClash { get; set; }
}
