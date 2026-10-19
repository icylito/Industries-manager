using api_v2.Application.Auth;
using api_v2.Application.Ports;
using api_v2.Domain.Accounts;
using api_v2.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace api_v2.Infrastructure.Persistence;

// Reads the bearer token off the request and loads the account and session behind it, through EF
public class SessionUser(IHttpContextAccessor http, AppDbContext db) : ICurrentUser
{
    private static readonly TimeSpan TouchEvery = TimeSpan.FromMinutes(5);

    private bool _loaded;
    private User? _user;
    private long? _sessionId;

    public string Name => _user?.Username ?? "guest";
    public bool IsAdmin => _user is { Disabled: false, Role: Roles.Admin };
    public bool IsManager => _user is { Disabled: false, Role: Roles.Admin or Roles.Manager };
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

    public async Task LoadAsync(CancellationToken ct = default)
    {
        if (_loaded) return;
        _loaded = true;

        var token = TokenFrom(http.HttpContext);
        if (token is null) return;

        var hash = SessionPolicy.HashToken(token);
        var now = DateTimeOffset.UtcNow;
        var session = await db.Sessions.Include(s => s.User).FirstOrDefaultAsync(s => s.TokenHash == hash && s.ExpiresAt > now, ct);
        if (session?.User is null || session.User.Disabled) return;

        _user = session.User;
        _sessionId = session.Id;

        // Using the page keeps the session alive, but only written now and then
        if (now - session.LastSeenAt > TouchEvery)
        {
            session.LastSeenAt = now;
            var slide = now + SessionPolicy.IdleLimit;
            var cap = session.CreatedAt + SessionPolicy.AgeLimit;
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
