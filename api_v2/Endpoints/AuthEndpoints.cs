using System.Security.Cryptography;
using api_v2.Auth;
using api_v2.Data;
using api_v2.Model;
using Microsoft.EntityFrameworkCore;

namespace api_v2.Endpoints;

public record LoginBody(string? Username, string? Password);
public record PasswordBody(string? Current, string? New);

public static class AuthEndpoints
{
    public static void MapAuth(this WebApplication app)
    {
        var auth = app.MapGroup("/auth").RequireDatabaseReady();

        // Signs in. A wrong username and a wrong password get the same answer, so nobody can find out which names exist.
        auth.MapPost("/login", async (LoginBody body, AppDbContext db, LoginFailures failures, HttpContext http, CancellationToken ct) =>
        {
            var username = (body.Username ?? "").Trim().ToLowerInvariant();
            var password = body.Password ?? "";
            // Too many wrong passwords for this name lately, from anywhere. Asked before the password is checked,
            // so a guess sent during the wait tells nothing even when it's right.
            if (failures.WaitFor(username) is { } wait)
            {
                return TooManyTries(http, wait);
            }
            var user = username.Length is > 0 and <= 64 ? await db.Users.FirstOrDefaultAsync(u => u.Username == username, ct) : null;

            var ok = false;
            var needsRehash = false;
            if (user is null || password.Length == 0 || password.Length > 1000)
            {
                PasswordHasher.VerifyDummy(password.Length > 1000 ? "" : password);
            }
            else
            {
                ok = PasswordHasher.Verify(password, user.PasswordHash, out needsRehash);
            }
            if (!ok || user is null)
            {
                if (username.Length is > 0 and <= 64) failures.Failed(username);
                return Results.Problem("That username and password don't match", statusCode: StatusCodes.Status401Unauthorized,
                    title: "Sign in failed");
            }
            if (user.Disabled)
            {
                return Results.Problem("This account is turned off. Ask an admin", statusCode: StatusCodes.Status403Forbidden,
                    title: "Account off");
            }

            failures.Succeeded(username);
            var now = DateTimeOffset.UtcNow;
            if (needsRehash) user.PasswordHash = PasswordHasher.Hash(password);
            user.LastLoginAt = now;

            var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
            var expires = now + SessionUser.IdleLimit;
            db.Sessions.Add(new Session
            {
                UserId = user.Id,
                TokenHash = SessionUser.HashToken(token),
                CreatedAt = now,
                LastSeenAt = now,
                ExpiresAt = expires
            });
            await db.SaveChangesAsync(ct);
            // Old sign ins that ran out are cleared out each time someone signs in
            await db.Sessions.Where(s => s.ExpiresAt < now).ExecuteDeleteAsync(ct);

            return Results.Ok(new { Token = token, ExpiresAt = expires, User = UserService.ToDto(user) });
        }).RequireRateLimiting("login");

        // Who the token belongs to. The page asks on load, 401 means it has to sign in again.
        auth.MapGet("/me", async (ICurrentUser user, AppDbContext db, CancellationToken ct) =>
        {
            await user.LoadAsync(ct);
            if (!user.IsSignedIn || user.Id is not int id)
            {
                return Results.Problem("Sign in to do this", statusCode: StatusCodes.Status401Unauthorized, title: "Sign in");
            }
            return Results.Ok(UserService.ToDto(await db.Users.AsNoTracking().FirstAsync(u => u.Id == id, ct)));
        });

        auth.MapPost("/logout", async (ICurrentUser user, AppDbContext db, CancellationToken ct) =>
        {
            await user.LoadAsync(ct);
            if (user.SessionId is long id)
            {
                await db.Sessions.Where(s => s.Id == id).ExecuteDeleteAsync(ct);
            }
            return Results.NoContent();
        });

        // Picks a new password. This is also how a new or reset account gets past "Pick a new password first".
        auth.MapPost("/password", async (PasswordBody body, ICurrentUser current, AppDbContext db, CancellationToken ct) =>
        {
            await current.LoadAsync(ct);
            if (!current.IsSignedIn || current.Id is not int id)
            {
                return Results.Problem("Sign in to do this", statusCode: StatusCodes.Status401Unauthorized, title: "Sign in");
            }
            var user = await db.Users.FirstAsync(u => u.Id == id, ct);

            if (!PasswordHasher.Verify(body.Current ?? "", user.PasswordHash, out _))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["current"] = ["That isn't your current password"] });
            }
            var problem = PasswordHasher.CheckNew(body.New, user.Username);
            if (problem is not null)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["new"] = [problem] });
            }
            if (body.New == body.Current)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["new"] = ["Pick a password you haven't used just now"] });
            }

            user.PasswordHash = PasswordHasher.Hash(body.New!);
            user.MustChangePassword = false;
            user.PasswordChangedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(ct);
            // Everywhere else this person was signed in is signed out
            var keep = current.SessionId;
            await db.Sessions.Where(s => s.UserId == id && s.Id != keep).ExecuteDeleteAsync(ct);
            return Results.Ok(UserService.ToDto(user));
        }).RequireRateLimiting("login");
    }

    // 429 with Retry-After, so the page can say how long to wait. Used by the per-name count here and the
    // per-address limit in Program.cs, so both say the same thing.
    public static IResult TooManyTries(HttpContext http, TimeSpan wait)
    {
        var seconds = Math.Max(1, (int)Math.Ceiling(wait.TotalSeconds));
        http.Response.Headers.RetryAfter = seconds.ToString();
        var when = seconds < 90 ? $"{seconds} seconds" : $"{(int)Math.Ceiling(seconds / 60.0)} minutes";
        return Results.Problem($"Too many tries. Try again in {when}", statusCode: StatusCodes.Status429TooManyRequests,
            title: "Slow down");
    }
}
