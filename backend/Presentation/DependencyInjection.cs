using System.Threading.RateLimiting;
using api_v2.Presentation.Endpoints;
using api_v2.Presentation.Errors;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Configuration;

namespace api_v2.Presentation;

public static class DependencyInjection
{
    // How the HTTP side reads and answers: strict numbers, the plain error answers, and the sign in limit
    public static IServiceCollection AddPresentation(this IServiceCollection services, IConfiguration config)
    {
        // A number has to arrive as a number, "5" as text is refused
        services.Configure<JsonOptions>(options =>
            options.SerializerOptions.NumberHandling = System.Text.Json.Serialization.JsonNumberHandling.Strict);
        services.AddProblemDetails();
        // What a failed request answers, and how loudly it is logged: Errors/ApiExceptionHandler.cs
        services.AddExceptionHandler<ApiExceptionHandler>();
        services.Configure<RouteHandlerOptions>(o => o.ThrowOnBadRequest = true);

        // Signing in is limited per address, so a password can't be guessed by trying over and over
        var loginTries = config.GetValue("Auth:LoginTriesPerMinute", 5);
        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            options.AddPolicy("login", context => RateLimitPartition.GetFixedWindowLimiter(
                context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                _ => new FixedWindowRateLimiterOptions { PermitLimit = loginTries, Window = TimeSpan.FromMinutes(1) }));
            options.OnRejected = async (context, token) =>
            {
                var wait = context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retry) ? retry : TimeSpan.FromMinutes(1);
                await AuthEndpoints.TooManyTries(context.HttpContext, wait).ExecuteAsync(context.HttpContext);
            };
        });
        return services;
    }

    // Every route the page calls
    public static WebApplication MapPresentation(this WebApplication app)
    {
        app.MapHealth();
        app.MapAuth();
        app.MapUsers();
        app.MapIndustries();
        app.MapSchema();
        app.MapHistory();
        app.MapBackups();
        app.MapRequests();
        app.MapScratchpad();
        app.MapMe();
        app.MapUserTables();
        return app;
    }
}
