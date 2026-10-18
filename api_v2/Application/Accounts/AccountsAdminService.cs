using api_v2.Application.Auth;
using api_v2.Application.Ports;
using api_v2.Domain.Accounts;
using api_v2.Domain.Entities;

namespace api_v2.Application.Accounts;

// The account rules a developer needs from the outside: is a username free, are the clash flags stale,
// and the startup check that someone can always sign in.
public class AccountsAdminService(IAccounts accounts, IPasswordHasher hasher, ILogger<AccountsAdminService> log)
{
    public Task<bool> UsernameTakenAsync(string username, int? exceptId, CancellationToken ct) =>
        accounts.UsernameTakenAsync(username, exceptId, ct);

    public Task RefreshNameClashesAsync(CancellationToken ct) => accounts.RefreshNameClashesAsync(ct);

    // Runs on every start. Makes sure someone can always get in:
    // - Auth:ResetPassword=<username> gives that account a new random password (for a forgotten password)
    // - with no working admin, the account "admin" is made or turned back on with a random password
    // Both print the password once in the API window.
    public async Task EnsureAdminAsync(IConfiguration config, CancellationToken ct)
    {
        var reset = config["Auth:ResetPassword"]?.Trim().ToLowerInvariant();
        if (!string.IsNullOrEmpty(reset))
        {
            var target = await accounts.FindByUsernameAsync(reset, ct);
            if (target is null)
            {
                log.LogWarning("Auth:ResetPassword is set to {Name} but there's no account with that name", reset);
            }
            else
            {
                var password = hasher.Generate();
                target.PasswordHash = hasher.Hash(password);
                target.Disabled = false;
                target.Role = Roles.Admin;
                target.MustChangePassword = true;
                target.PasswordChangedAt = DateTimeOffset.UtcNow;
                await accounts.SaveAsync(ct);
                await accounts.DeleteSessionsForUserAsync(target.Id, ct);
                log.LogWarning("Password reset. Username {Name}, new password {Password}. Sign in and pick a new one, then remove Auth:ResetPassword from the settings.",
                    target.Username, password);
            }
        }

        if (await accounts.AnyEnabledAdminAsync(ct)) return;

        var generated = hasher.Generate();
        var admin = await accounts.FindByUsernameAsync("admin", ct);
        if (admin is null)
        {
            admin = new User
            {
                Username = "admin",
                PasswordHash = hasher.Hash(generated),
                Role = Roles.Admin,
                MustChangePassword = true,
                CreatedAt = DateTimeOffset.UtcNow,
                CreatedBy = "system"
            };
            accounts.AddUser(admin);
        }
        else
        {
            admin.PasswordHash = hasher.Hash(generated);
            admin.Role = Roles.Admin;
            admin.Disabled = false;
            admin.MustChangePassword = true;
            admin.PasswordChangedAt = DateTimeOffset.UtcNow;
        }
        await accounts.SaveAsync(ct);
        log.LogWarning("There was no admin, so one was made. Username admin, password {Password}. Sign in and pick a new password, this message shows only once.",
            generated);
    }
}
