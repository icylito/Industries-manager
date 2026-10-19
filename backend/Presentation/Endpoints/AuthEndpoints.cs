using api_v2.Application.Auth;
using api_v2.Presentation.Contracts;
using api_v2.Application.Ports;

namespace api_v2.Presentation.Endpoints;

// The sign in routes. Each endpoint binds its input, calls one use case in Application/Auth and turns the answer
// into an HTTP result; sessions, passwords and the token live behind that service.
public static class AuthEndpoints
{
    public static void MapAuth(this WebApplication app)
    {
        var auth = app.MapGroup("/auth").RequireDatabaseReady();

        // Signs in. A wrong username and a wrong password get the same answer, so nobody can find out which names exist.
        auth.MapPost("/login", async (LoginBody body, AuthService service, HttpContext http, CancellationToken ct) =>
        {
            var result = await service.LoginAsync(body.Username, body.Password, ct);
            return result switch
            {
                LoginResult.SignedIn signedIn => Results.Ok(new
                {
                    signedIn.Token,
                    signedIn.ExpiresAt,
                    signedIn.User
                }),
                LoginResult.TooManyTries tooMany => TooManyTries(http, tooMany.Wait),
                LoginResult.AccountOff => Results.Problem("This account is turned off. Ask an admin",
                    statusCode: StatusCodes.Status403Forbidden, title: "Account off"),
                _ => Results.Problem("That username and password don't match",
                    statusCode: StatusCodes.Status401Unauthorized, title: "Sign in failed")
            };
        }).RequireRateLimiting("login");

        // Who the token belongs to. The page asks on load, 401 means it has to sign in again.
        auth.MapGet("/me", async (AuthService service, ICurrentUser user, CancellationToken ct) =>
        {
            var result = await service.MeAsync(user, ct);
            return result switch
            {
                MeResult.SignedIn signedIn => Results.Ok(signedIn.User),
                _ => Results.Problem("Sign in to do this", statusCode: StatusCodes.Status401Unauthorized, title: "Sign in")
            };
        });

        auth.MapPost("/logout", async (AuthService service, ICurrentUser user, CancellationToken ct) =>
        {
            await service.LogoutAsync(user, ct);
            return Results.NoContent();
        });

        // Picks a new password. This is also how a new or reset account gets past "Pick a new password first".
        auth.MapPost("/password", async (PasswordBody body, AuthService service, ICurrentUser user, CancellationToken ct) =>
        {
            var result = await service.ChangePasswordAsync(user, body.Current, body.New, ct);
            return result switch
            {
                ChangePasswordResult.Changed changed => Results.Ok(changed.User),
                ChangePasswordResult.Invalid invalid => Results.ValidationProblem(invalid.Errors),
                _ => Results.Problem("Sign in to do this", statusCode: StatusCodes.Status401Unauthorized, title: "Sign in")
            };
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
