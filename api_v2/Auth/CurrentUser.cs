using System.Security.Cryptography;
using System.Text;
using api_v2.Data;
using api_v2.Model;
using Microsoft.EntityFrameworkCore;

namespace api_v2.Auth;

// Who is making the request. The page sends the token from its sign in as "Authorization: Bearer ...".
// Nothing here runs until an endpoint asks (RequireSignIn or RequireAdmin), so open endpoints never touch the database for it.
public interface ICurrentUser
{
    // The username, or "guest" when nobody is signed in
    string Name { get; }
    bool IsAdmin { get; }
    bool IsSignedIn { get; }
    int? Id { get; }
    long? SessionId { get; }
    // True for a new account or after a reset, until the person picks their own password
    bool MustChangePassword { get; }
    Task LoadAsync(CancellationToken ct = default);
}

public static class Roles
{
    public const string Admin = "admin";
    public const string Normal = "normal";

    public static bool IsValid(string? role) => role is Admin or Normal;
}

public class SessionUser(IHttpContextAccessor http, AppDbContext db) : ICurrentUser
{
    // A session lasts 12 hours after its last use, and 7 days at most
    public static readonly TimeSpan IdleLimit = TimeSpan.FromHours(12);
    public static readonly TimeSpan AgeLimit = TimeSpan.FromDays(7);
    private static readonly TimeSpan TouchEvery = TimeSpan.FromMinutes(5);

    private bool _loaded;
    private User? _user;
    private long? _sessionId;

    public string Name => _user?.Username ?? "guest";
    public bool IsAdmin => _user is { Disabled: false, Role: Roles.Admin };
    public bool IsSignedIn => _user is { Disabled: false };
    public int? Id => _user?.Id;
    public long? SessionId => _sessionId;
    public bool MustChangePassword => _user?.MustChangePassword ?? false;

    public static string? TokenFrom(HttpContext? context)
    {
        var header = context?.Request.Headers.Authorization.ToString();
        if (string.IsNullOrEmpty(header) || !header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)) return null;
        var token = header["Bearer ".Length..].Trim();
        return token.Length is > 0 and <= 200 ? token : null;
    }

    public static byte[] HashToken(string token) => SHA256.HashData(Encoding.UTF8.GetBytes(token));

    public async Task LoadAsync(CancellationToken ct = default)
    {
        if (_loaded) return;
        _loaded = true;

        var token = TokenFrom(http.HttpContext);
        if (token is null) return;

        var hash = HashToken(token);
        var now = DateTimeOffset.UtcNow;
        var session = await db.Sessions.Include(s => s.User).FirstOrDefaultAsync(s => s.TokenHash == hash && s.ExpiresAt > now, ct);
        if (session?.User is null || session.User.Disabled) return;

        _user = session.User;
        _sessionId = session.Id;

        // Using the page keeps the session alive, but only written now and then
        if (now - session.LastSeenAt > TouchEvery)
        {
            session.LastSeenAt = now;
            var slide = now + IdleLimit;
            var cap = session.CreatedAt + AgeLimit;
            session.ExpiresAt = slide < cap ? slide : cap;
            try
            {
                await db.SaveChangesAsync(ct);
            }
            catch (Exception)
            {
                // Staying signed in doesn't depend on this write
                db.ChangeTracker.Clear();
            }
        }
    }
}

public static class AdminExtensions
{
    private static IResult NotSignedIn() =>
        Results.Problem("Sign in to do this", statusCode: StatusCodes.Status401Unauthorized, title: "Sign in");

    private static IResult NeedsNewPassword() =>
        Results.Problem("Pick a new password first", statusCode: StatusCodes.Status403Forbidden, title: "New password needed");

    // Anyone with an account. Put on endpoints that add or change rows.
    public static TBuilder RequireSignIn<TBuilder>(this TBuilder builder) where TBuilder : IEndpointConventionBuilder
    {
        return builder.AddEndpointFilter(async (context, next) =>
        {
            var user = context.HttpContext.RequestServices.GetRequiredService<ICurrentUser>();
            await user.LoadAsync(context.HttpContext.RequestAborted);
            if (!user.IsSignedIn) return NotSignedIn();
            if (user.MustChangePassword) return NeedsNewPassword();
            return await next(context);
        });
    }

    // Put on any endpoint that changes rules, history or settings
    public static TBuilder RequireAdmin<TBuilder>(this TBuilder builder) where TBuilder : IEndpointConventionBuilder
    {
        return builder.AddEndpointFilter(async (context, next) =>
        {
            var user = context.HttpContext.RequestServices.GetRequiredService<ICurrentUser>();
            await user.LoadAsync(context.HttpContext.RequestAborted);
            if (!user.IsSignedIn) return NotSignedIn();
            if (user.MustChangePassword) return NeedsNewPassword();
            if (!user.IsAdmin)
            {
                return Results.Problem("Only an admin can do this", statusCode: StatusCodes.Status403Forbidden,
                    title: "Not allowed");
            }
            return await next(context);
        });
    }

    // Reading the table. Open to guests unless Auth:GuestCanView is turned off.
    public static TBuilder RequireViewer<TBuilder>(this TBuilder builder) where TBuilder : IEndpointConventionBuilder
    {
        return builder.AddEndpointFilter(async (context, next) =>
        {
            var config = context.HttpContext.RequestServices.GetRequiredService<IConfiguration>();
            if (config.GetValue("Auth:GuestCanView", true)) return await next(context);

            var user = context.HttpContext.RequestServices.GetRequiredService<ICurrentUser>();
            await user.LoadAsync(context.HttpContext.RequestAborted);
            if (!user.IsSignedIn) return NotSignedIn();
            return await next(context);
        });
    }
}
