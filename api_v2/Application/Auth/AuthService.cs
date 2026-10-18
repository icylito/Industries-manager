using System.Security.Cryptography;
using api_v2.Application.Ports;
using api_v2.Domain.Entities;

namespace api_v2.Application.Auth;

public abstract record LoginResult
{
    public sealed record SignedIn(string Token, DateTimeOffset ExpiresAt, UserDto User) : LoginResult;
    public sealed record TooManyTries(TimeSpan Wait) : LoginResult;
    public sealed record Failed : LoginResult;
    public sealed record AccountOff : LoginResult;
}

public abstract record MeResult
{
    public sealed record SignedIn(UserDto User) : MeResult;
    public sealed record NotSignedIn : MeResult;
}

public abstract record ChangePasswordResult
{
    public sealed record Changed(UserDto User) : ChangePasswordResult;
    public sealed record NotSignedIn : ChangePasswordResult;
    public sealed record Invalid(IReadOnlyDictionary<string, string[]> Errors) : ChangePasswordResult;
}

// Signing in, checking a token, signing out and changing a password. The session token is made here,
// the account rows come from the IAccounts port.
public class AuthService(IAccounts accounts, IPasswordHasher hasher, LoginFailures failures)
{
    public async Task<LoginResult> LoginAsync(string? usernameRaw, string? passwordRaw, CancellationToken ct)
    {
        var username = (usernameRaw ?? "").Trim().ToLowerInvariant();
        var password = passwordRaw ?? "";
        // Too many wrong passwords for this name lately, from anywhere. Asked before the password is checked,
        // so a guess sent during the wait tells nothing even when it's right.
        if (failures.WaitFor(username) is { } wait)
        {
            return new LoginResult.TooManyTries(wait);
        }
        var user = username.Length is > 0 and <= 64 ? await accounts.FindByUsernameAsync(username, ct) : null;

        var ok = false;
        var needsRehash = false;
        if (user is null || password.Length == 0 || password.Length > 1000)
        {
            hasher.VerifyDummy(password.Length > 1000 ? "" : password);
        }
        else
        {
            ok = hasher.Verify(password, user.PasswordHash, out needsRehash);
        }
        if (!ok || user is null)
        {
            if (username.Length is > 0 and <= 64) failures.Failed(username);
            return new LoginResult.Failed();
        }
        if (user.Disabled)
        {
            return new LoginResult.AccountOff();
        }

        failures.Succeeded(username);
        var now = DateTimeOffset.UtcNow;
        if (needsRehash) user.PasswordHash = hasher.Hash(password);
        user.LastLoginAt = now;

        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var expires = now + SessionUser.IdleLimit;
        await accounts.AddSessionAsync(new Session
        {
            UserId = user.Id,
            TokenHash = SessionUser.HashToken(token),
            CreatedAt = now,
            LastSeenAt = now,
            ExpiresAt = expires
        }, now, ct);

        return new LoginResult.SignedIn(token, expires, UserService.ToDto(user));
    }

    public async Task<MeResult> MeAsync(ICurrentUser current, CancellationToken ct)
    {
        await current.LoadAsync(ct);
        if (!current.IsSignedIn || current.Id is not int id)
        {
            return new MeResult.NotSignedIn();
        }
        return new MeResult.SignedIn(UserService.ToDto(await accounts.FindAsync(id, ct)));
    }

    public async Task LogoutAsync(ICurrentUser current, CancellationToken ct)
    {
        await current.LoadAsync(ct);
        if (current.SessionId is long id)
        {
            await accounts.DeleteSessionAsync(id, ct);
        }
    }

    public async Task<ChangePasswordResult> ChangePasswordAsync(
        ICurrentUser current, string? currentPassword, string? newPassword, CancellationToken ct)
    {
        await current.LoadAsync(ct);
        if (!current.IsSignedIn || current.Id is not int id)
        {
            return new ChangePasswordResult.NotSignedIn();
        }
        var user = await accounts.FindAsync(id, ct);

        if (!hasher.Verify(currentPassword ?? "", user.PasswordHash, out _))
        {
            return new ChangePasswordResult.Invalid(new Dictionary<string, string[]>
            {
                ["current"] = ["That isn't your current password"]
            });
        }
        var problem = hasher.CheckNew(newPassword, user.Username);
        if (problem is not null)
        {
            return new ChangePasswordResult.Invalid(new Dictionary<string, string[]> { ["new"] = [problem] });
        }
        if (newPassword == currentPassword)
        {
            return new ChangePasswordResult.Invalid(new Dictionary<string, string[]>
            {
                ["new"] = ["Pick a password you haven't used just now"]
            });
        }

        user.PasswordHash = hasher.Hash(newPassword!);
        user.MustChangePassword = false;
        user.PasswordChangedAt = DateTimeOffset.UtcNow;
        await accounts.SaveAsync(ct);
        // Everywhere else this person was signed in is signed out
        await accounts.DeleteOtherSessionsAsync(id, current.SessionId, ct);
        return new ChangePasswordResult.Changed(UserService.ToDto(user));
    }
}
