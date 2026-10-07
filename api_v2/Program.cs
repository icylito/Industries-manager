using api_v2.Model;
using api_v2.Endpoints;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.OpenApi;
using Microsoft.EntityFrameworkCore;
using static Microsoft.OpenApi.OpenApiSpecVersion;
using api_v2.Data;
using api_v2.Auth;
using api_v2.Rules;
using api_v2.Backups;
using Npgsql;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;


var builder = WebApplication.CreateBuilder(args);
// Pages that may call the API. Cors:Origins in appsettings overrides this list, the Angular dev server is the default.
var origins = builder.Configuration.GetSection("Cors:Origins").Get<string[]>() is { Length: > 0 } configured
    ? configured
    : ["http://localhost:4200"];
builder.Services.AddCors(options => options.AddPolicy("Angular", policy =>
    policy.WithOrigins(origins).AllowAnyHeader().AllowAnyMethod().WithExposedHeaders("Content-Disposition")));
// A number has to arrive as a number, "5" as text is refused
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.NumberHandling = System.Text.Json.Serialization.JsonNumberHandling.Strict);
builder.Services.AddValidation(); // Validating all the required, range, and length in Dtos folder
builder.Services.AddProblemDetails();
builder.Services.Configure<RouteHandlerOptions>(o => o.ThrowOnBadRequest = true);
builder.Services.AddOpenApi(options => 
options.OpenApiVersion = Microsoft.OpenApi.OpenApiSpecVersion.OpenApi3_0);
var connections = DatabaseConnections.From(builder.Configuration);
builder.Services.AddSingleton(connections);
// EnableRetryOnFailure retries a query up to 3 times on transient errors like a dropped connection
builder.Services.AddDbContext<AppDbContext>(options => options.UseNpgsql(connections.Main,
    npgsql => npgsql.EnableRetryOnFailure(maxRetryCount: 3, maxRetryDelay: TimeSpan.FromSeconds(5), errorCodesToAdd: null)));

// Auto migration, applies pending migrations on startup and tracks the result for /health
builder.Services.AddSingleton<DatabaseStatus>();
builder.Services.AddHostedService<MigrationService>();

// Collector copies, versioned rules, backups and the restore from a backup
builder.Services.AddSingleton<SettingsService>();
builder.Services.AddSingleton<CollectorStore>();
builder.Services.AddSingleton<AppLocks>();
builder.Services.AddSingleton<api_v2.History.TableWriter>();
builder.Services.AddSingleton<RulesService>();
builder.Services.AddSingleton<BackupService>();
builder.Services.AddSingleton<BackupRestore>();
builder.Services.AddHostedService<BackupScheduler>();
// Notices when the history database goes away or comes back after startup, so the page's badge stays right
builder.Services.AddHostedService<HistoryMonitor>();
// Who is signed in comes from the token the page sends, see Auth/CurrentUser.cs
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ICurrentUser, SessionUser>();
// Signing in is limited per address, so a password can't be guessed by trying over and over
var loginTries = builder.Configuration.GetValue("Auth:LoginTriesPerMinute", 5);
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("login", context => RateLimitPartition.GetFixedWindowLimiter(
        context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = loginTries, Window = TimeSpan.FromMinutes(1) }));
    options.OnRejected = async (context, token) =>
    {
        await Results.Problem("Too many tries. Wait a minute and try again", statusCode: StatusCodes.Status429TooManyRequests,
            title: "Slow down").ExecuteAsync(context.HttpContext);
    };
});

var app = builder.Build();

app.UseExceptionHandler(errors =>
{
    errors.Run(async context =>
    {
        var error = context.Features.Get<IExceptionHandlerFeature>()?.Error;
        if (error is not null)
        {
            var log = context.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("api_v2");
            log.LogError(error, "Request failed with {ExceptionType}", error.GetType().Name);
        }

        var (status, title, detail) = Describe(error);
        await Results.Problem(detail, statusCode: status, title: title).ExecuteAsync(context);
    });
});

app.UseCors("Angular");
app.UseRateLimiter();

// Always 200 so the frontend can read the state, the body says if the database is usable
app.MapGet("/health", (DatabaseStatus status) => Results.Ok(status.Snapshot()));
app.MapAuth();
app.MapUsers();
app.MapIndustries();
app.MapSchema();
app.MapHistory();
app.MapBackups();
app.MapRequests();
app.MapOpenApi();
app.UseSwaggerUI(options =>
{
    options.SwaggerEndpoint("/openapi/v1.json", "api_v2");
});

app.Run();

static (int Status, string Title, string Detail) Describe(Exception? error)
{
    PostgresException? postgres = null;
    var busy = false;
    var concurrency = false;
    var badRequest = false;

    for (var current = error; current is not null; current = current.InnerException)
    {
        switch (current)
        {
            case AppBusyException:
                busy = true;
                break;
            case PostgresException pg:
                postgres ??= pg;
                break;
            case DbUpdateConcurrencyException:
                concurrency = true;
                break;
            case BadHttpRequestException:
                badRequest = true;
                break;
        }
    }

    if (busy)
    {
        return (StatusCodes.Status503ServiceUnavailable, "Busy",
            "Someone else is changing this right now. Try again in a moment");
    }
    if (postgres?.SqlState == PostgresErrorCodes.UniqueViolation)
    {
        return (StatusCodes.Status409Conflict, "Already taken", "That name is already taken");
    }
    if (concurrency)
    {
        return (StatusCodes.Status409Conflict, "Changed meanwhile",
            "Someone else changed or deleted this at the same time. Reload and try again");
    }
    if (postgres?.SqlState == PostgresErrorCodes.ProgramLimitExceeded)
    {
        return (StatusCodes.Status400BadRequest, "Too long", "That value is too long to save");
    }
    if (postgres?.SqlState is PostgresErrorCodes.UntranslatableCharacter or PostgresErrorCodes.CharacterNotInRepertoire)
    {
        return (StatusCodes.Status400BadRequest, "Bad character", "The text has a character that can't be saved");
    }
    if (badRequest)
    {
        return (StatusCodes.Status400BadRequest, "Couldn't read it",
            "The request couldn't be read. Check the values and try again");
    }
    return (StatusCodes.Status500InternalServerError, "Something went wrong",
        "Something went wrong. Nothing was saved if you see this, try again or tell a developer");
}
