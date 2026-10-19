using System.Text.RegularExpressions;
using api_v2.Domain.Entities;
using api_v2.Domain.Rules;

namespace api_v2.Application.Auth;

// What the page gets to see about a person. Never the password hash.
public record UserDto(int Id, string Username, string Role, bool Disabled, bool MustChangePassword,
    DateTimeOffset CreatedAt, DateTimeOffset? LastLoginAt, string? DisplayName = null, DateTimeOffset? AvatarAt = null,
    bool NameClash = false);

// The shape a username has to have. The account rows themselves live behind IAccounts.
public static class UserService
{
    private static readonly Regex NameRule = new("^[a-z0-9._-]{3,32}$", RegexOptions.Compiled);
    // Used in History and logs for things nobody signed in for, so nobody can take them
    private static readonly HashSet<string> Reserved = ["local", "system", "guest"];

    public static UserDto ToDto(User u) =>
        new(u.Id, u.Username, u.Role, u.Disabled, u.MustChangePassword, u.CreatedAt, u.LastLoginAt, u.DisplayName, u.AvatarAt, u.NameClash);

    // Usernames are saved trimmed and lowercase. Returns the problem in plain words, or null when it's fine.
    public static string? CheckUsername(string? raw, out string clean)
    {
        clean = (raw ?? "").Trim().ToLowerInvariant();
        if (clean.Length == 0) return "Type a username";
        if (!NameRule.IsMatch(clean)) return "A username is 3 to 32 letters, digits, dots, dashes or underscores";
        if (Reserved.Contains(clean)) return "That username is kept for the system, pick another";
        if (Names.HasNoLetters(clean)) return Names.NoKeyMessage;
        return null;
    }
}
