using System.Text.RegularExpressions;
using api_v2.Data;
using api_v2.Model;
using api_v2.Rules;
using Microsoft.EntityFrameworkCore;

namespace api_v2.Auth;

// What the page gets to see about a person. Never the password hash.
public record UserDto(int Id, string Username, string Role, bool Disabled, bool MustChangePassword,
    DateTimeOffset CreatedAt, DateTimeOffset? LastLoginAt, string? DisplayName = null, DateTimeOffset? AvatarAt = null,
    bool NameClash = false);

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

    // True when another account has the same username by the one name rule (Rules/Names.cs): "ali.k" and "ali_k"
    public static async Task<bool> UsernameTakenAsync(AppDbContext db, string username, int? exceptId, CancellationToken ct) =>
        await db.Database.SqlQuery<int>($"""
            SELECT count(*)::int AS "Value" FROM "Users" WHERE "Username" COLLATE name_rule = {username} AND "Id" <> {exceptId ?? 0}
            """).SingleAsync(ct) > 0;

    // After a rename or a delete, an account flagged for clashing may not clash any more: its flag clears when no
    // older account has its username by the one name rule. New clashes are never made, they are refused.
    public static async Task RefreshNameClashesAsync(AppDbContext db, CancellationToken ct) =>
        await db.Database.ExecuteSqlRawAsync("""
            UPDATE "Users" AS u SET "NameClash" = EXISTS (
                SELECT 1 FROM "Users" AS o WHERE o."Id" < u."Id" AND o."Username" COLLATE name_rule = u."Username")
            WHERE u."NameClash"
            """, ct);

    // Runs on every start. Makes sure someone can always get in:
    // - Auth:ResetPassword=<username> gives that account a new random password (for a forgotten password)
    // - with no working admin, the account "admin" is made or turned back on with a random password
    // Both print the password once in the API window.
    public static async Task EnsureAdminAsync(AppDbContext db, IConfiguration config, ILogger log, CancellationToken ct)
    {
        var reset = config["Auth:ResetPassword"]?.Trim().ToLowerInvariant();
        if (!string.IsNullOrEmpty(reset))
        {
            var target = await db.Users.FirstOrDefaultAsync(u => u.Username == reset, ct);
            if (target is null)
            {
                log.LogWarning("Auth:ResetPassword is set to {Name} but there's no account with that name", reset);
            }
            else
            {
                var password = PasswordHasher.Generate();
                target.PasswordHash = PasswordHasher.Hash(password);
                target.Disabled = false;
                target.Role = Roles.Admin;
                target.MustChangePassword = true;
                target.PasswordChangedAt = DateTimeOffset.UtcNow;
                await db.SaveChangesAsync(ct);
                await db.Sessions.Where(s => s.UserId == target.Id).ExecuteDeleteAsync(ct);
                log.LogWarning("Password reset. Username {Name}, new password {Password}. Sign in and pick a new one, then remove Auth:ResetPassword from the settings.",
                    target.Username, password);
            }
        }

        if (await db.Users.AnyAsync(u => u.Role == Roles.Admin && !u.Disabled, ct)) return;

        var generated = PasswordHasher.Generate();
        var admin = await db.Users.FirstOrDefaultAsync(u => u.Username == "admin", ct);
        if (admin is null)
        {
            admin = new User
            {
                Username = "admin",
                PasswordHash = PasswordHasher.Hash(generated),
                Role = Roles.Admin,
                MustChangePassword = true,
                CreatedAt = DateTimeOffset.UtcNow,
                CreatedBy = "system"
            };
            db.Users.Add(admin);
        }
        else
        {
            admin.PasswordHash = PasswordHasher.Hash(generated);
            admin.Role = Roles.Admin;
            admin.Disabled = false;
            admin.MustChangePassword = true;
            admin.PasswordChangedAt = DateTimeOffset.UtcNow;
        }
        await db.SaveChangesAsync(ct);
        log.LogWarning("There was no admin, so one was made. Username admin, password {Password}. Sign in and pick a new password, this message shows only once.",
            generated);
    }
}
