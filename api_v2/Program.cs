using api_v2.Domain.Entities;
using api_v2.Presentation.Endpoints;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.OpenApi;
using Microsoft.EntityFrameworkCore;
using static Microsoft.OpenApi.OpenApiSpecVersion;
using api_v2.Application.Health;
using api_v2.Application.Hosted;
using api_v2.Application.Settings;
using api_v2.Application.Startup;
using api_v2.Infrastructure.Configuration;
using api_v2.Infrastructure.Export;
using api_v2.Infrastructure.Files;
using api_v2.Infrastructure.Persistence;
using api_v2.Application.Auth;
using api_v2.Infrastructure.Security;
using api_v2.Domain.Rules;
using api_v2.Application.Backups;
using api_v2.Application.Industries;
using api_v2.Application.Ports;
using Npgsql;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using api_v2.Application.Me;
using api_v2.Application.Profile;
using api_v2.Application.Requests;


var builder = WebApplication.CreateBuilder(args);
// Logs go to the console only. The default Windows Event Log writer needs an elevated window and crashed startup when it was refused
builder.Logging.ClearProviders();
builder.Logging.AddConsole();
// Pages that may call the API. Cors:Origins in appsettings overrides this list, the Angular dev server is the default.
// Any port on this PC is allowed too (localhost, 127.0.0.1, [::1]), so `ng serve --port` works without a config change.
var origins = builder.Configuration.GetSection("Cors:Origins").Get<string[]>() is { Length: > 0 } configured
    ? configured
    : ["http://localhost:4200"];
var localOrigin = new System.Text.RegularExpressions.Regex(@"^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$");
builder.Services.AddCors(options => options.AddPolicy("Angular", policy =>
    policy.SetIsOriginAllowed(origin => origins.Contains(origin) || localOrigin.IsMatch(origin))
        .AllowAnyHeader().AllowAnyMethod().WithExposedHeaders("Content-Disposition", "Retry-After")));
// A number has to arrive as a number, "5" as text is refused
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.NumberHandling = System.Text.Json.Serialization.JsonNumberHandling.Strict);
builder.Services.AddValidation(); // Validating all the required, range, and length in Dtos folder
builder.Services.AddProblemDetails();
// What a failed request answers, and how loudly it is logged: Errors/ApiExceptionHandler.cs
builder.Services.AddExceptionHandler<api_v2.Presentation.Errors.ApiExceptionHandler>();
builder.Services.Configure<RouteHandlerOptions>(o => o.ThrowOnBadRequest = true);
// No JSON body here is big on purpose: the biggest is a Scratchpad board, held to 1,000,000 bytes by BoardRules.
// Anything above this is refused before it is read. An upload that needs more raises its own limit on its request,
// see BackupEndpoints.cs and ScratchFileEndpoints.cs. Http:MaxRequestBodyKb in appsettings changes it.
var maxBodyKb = Math.Max(64, builder.Configuration.GetValue("Http:MaxRequestBodyKb", 2048));
builder.WebHost.ConfigureKestrel(kestrel => kestrel.Limits.MaxRequestBodySize = maxBodyKb * 1024L);
// The table list and a version's rows are big JSON that squeezes well. Bearer sign in, no cookies, and nothing a
// caller sends is reflected into a body next to a secret, so compressing over https is fine here.
builder.Services.AddResponseCompression(options =>
{
    options.EnableForHttps = true;
    options.Providers.Add<Microsoft.AspNetCore.ResponseCompression.BrotliCompressionProvider>();
    options.Providers.Add<Microsoft.AspNetCore.ResponseCompression.GzipCompressionProvider>();
});
builder.Services.AddOpenApi(options => 
options.OpenApiVersion = Microsoft.OpenApi.OpenApiSpecVersion.OpenApi3_0);
var connections = DatabaseConnections.From(builder.Configuration);
builder.Services.AddSingleton(connections);
// EnableRetryOnFailure retries a query up to 3 times on transient errors like a dropped connection
builder.Services.AddDbContext<AppDbContext>(options => options.UseNpgsql(connections.Main,
    npgsql => npgsql.EnableRetryOnFailure(maxRetryCount: 3, maxRetryDelay: TimeSpan.FromSeconds(5), errorCodesToAdd: null)));
// The two migration chains, only used to migrate: the data's, and what is always current with its own history table
builder.Services.AddDbContext<DataMigrationsContext>(options => options.UseNpgsql(connections.Main));
builder.Services.AddDbContext<StateMigrationsContext>(options => options.UseNpgsql(connections.Main,
    npgsql => npgsql.MigrationsHistoryTable(StateMigrationsContext.HistoryTable)));

// Auto migration, applies pending migrations on startup and tracks the result for /health
builder.Services.AddSingleton<DatabaseStatus>();
builder.Services.AddHostedService<MigrationService>();

// Collector copies, versioned rules, backups and the restore from a backup
builder.Services.AddSingleton<SettingsService>();
builder.Services.AddSingleton<CollectorStore>();
builder.Services.AddSingleton<AppLocks>();
// The live Industries table and the name check sit behind ports; the use cases in Application/Industries call them.
// The store is scoped because it works through the scoped AppDbContext.
builder.Services.AddScoped<IIndustryStore, IndustryStore>();
builder.Services.AddScoped<INameIndex, NameIndex>();
builder.Services.AddScoped<IndustryService>();
builder.Services.AddSingleton<ICollectorStore>(services => services.GetRequiredService<CollectorStore>());
builder.Services.AddSingleton<IAppLocks>(services => services.GetRequiredService<AppLocks>());
// Where uploaded Scratchpad files live on disk, created on startup. See Data/ScratchFileStore.cs
builder.Services.AddSingleton<ScratchFileStore>();
builder.Services.AddHostedService<api_v2.Application.Hosted.ScratchFileSweeper>();
// The readable JSON copy of every table from the Tables page, and the job that writes it on start and empties
// the bin. See Tables/UserTableMirror.cs and UserTables:Mirror in appsettings.
builder.Services.AddSingleton<api_v2.Application.Tables.UserTableMirror>();
builder.Services.AddHostedService<api_v2.Application.Hosted.TableBinSweeper>();
builder.Services.AddSingleton<api_v2.Application.History.TableWriter>();
builder.Services.AddSingleton<RulesService>();
// Signs every backup so only this app's own can be dropped back in, see Backups/BackupSigner.cs
builder.Services.AddSingleton<BackupSigner>();
builder.Services.AddSingleton<BackupService>();
builder.Services.AddSingleton<BackupRestore>();
builder.Services.AddHostedService<BackupScheduler>();
// Notices when the history database goes away or comes back after startup, so the page's badge stays right
builder.Services.AddHostedService<HistoryMonitor>();
// Who is signed in comes from the token the page sends, see Auth/CurrentUser.cs
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ICurrentUser, SessionUser>();
// Accounts, sessions and password checking sit behind ports, the use cases in Application/Auth call them
builder.Services.AddScoped<IAccounts, AccountStore>();
builder.Services.AddSingleton<IPasswordHasher, PasswordHasherAdapter>();
builder.Services.AddScoped<AuthService>();
// The person's own settings and profile card, and the rules their values are checked against
builder.Services.AddScoped<IMeStore, MeStore>();
builder.Services.AddScoped<MeService>();
builder.Services.AddScoped<IProfileStore, ProfileStore>();
builder.Services.AddScoped<ProfileService>();
// Requests for a developer, the same open one never made twice, behind one store
builder.Services.AddScoped<IRequestsStore, RequestStore>();
builder.Services.AddScoped<RequestService>();
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
        var wait = context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retry) ? retry : TimeSpan.FromMinutes(1);
        await api_v2.Presentation.Endpoints.AuthEndpoints.TooManyTries(context.HttpContext, wait).ExecuteAsync(context.HttpContext);
    };
});
// Wrong passwords per username, from any address, see Auth/LoginFailures.cs
builder.Services.AddSingleton<LoginFailures>();

// Https:Required turns http into a redirect to https and adds HSTS. Off by default so a fresh clone runs with no certificate,
// start.bat https turns it on together with the https launch profile. See README, Https.
var httpsRequired = builder.Configuration.GetValue("Https:Required", false);
if (httpsRequired)
{
    builder.Services.AddHttpsRedirection(options => options.HttpsPort = builder.Configuration.GetValue<int?>("Https:Port") ?? 7165);
}

var app = builder.Build();

// Make the Scratchpad file folder now, so a bad path or a denied folder fails at startup instead of on the
// first upload. See Scratchpad:Files in appsettings.
app.Services.GetRequiredService<ScratchFileStore>();
// The same for the folder of table copies
app.Services.GetRequiredService<api_v2.Application.Tables.UserTableMirror>();
// The backup signing key is made now if there isn't one, so the first backup doesn't wait on it
app.Services.GetRequiredService<BackupSigner>();

if (httpsRequired)
{
    app.UseHsts();
    app.UseHttpsRedirection();
}
// Passwords go over the wire at sign in, so say it in the window when nothing here is https
app.Lifetime.ApplicationStarted.Register(() =>
{
    if (app.Urls.Any(u => u.StartsWith("https://", StringComparison.OrdinalIgnoreCase))) return;
    app.Logger.LogWarning("Signing in goes over plain http here, fine on this PC only. On a shared network start with start.bat https, see README under Https");
});

// Errors/ApiExceptionHandler.cs answers and logs every exception a request throws
app.UseExceptionHandler();

// start.bat share puts the page server in front of the API. It says who the real caller is, so the sign in limit counts each
// device on its own. Only trusted from this PC (loopback), the default for ForwardedHeaders.
app.UseForwardedHeaders(new ForwardedHeadersOptions { ForwardedHeaders = Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedFor });
app.UseResponseCompression();
app.UseCors("Angular");
app.UseRateLimiter();

// Always 200 so the frontend can read the state, the body says if the database is usable.
// databases names the live table and the history database. The old fields stay as they are.
// Someone not signed in only learns if the database is up, which is all the page's badge needs. Signed in, it also
// names the databases and the migrations applied, which the seeding script prints.
app.MapGet("/health", async (DatabaseStatus status, DatabaseConnections connections, ICurrentUser user, CancellationToken ct) =>
{
    var body = System.Text.Json.JsonSerializer.SerializeToNode(status.Snapshot())!.AsObject();
    var signedIn = false;
    if (status.State == DatabaseState.Ready)
    {
        try
        {
            await user.LoadAsync(ct);
            signedIn = user.IsSignedIn;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // The answer still goes out, just the short one
        }
    }
    if (!signedIn)
    {
        var history = body["history"]?.AsObject();
        return Results.Json(new
        {
            state = body["state"]?.GetValue<string>(),
            // The ready message lists every migration, the others say what's wrong in plain words
            message = status.State == DatabaseState.Ready ? "Ready" : body["message"]?.GetValue<string>(),
            history = new { ready = history?["ready"]?.GetValue<bool>() ?? false, message = history?["message"]?.GetValue<string>() ?? "" }
        });
    }
    body["databases"] = System.Text.Json.JsonSerializer.SerializeToNode(connections.PublicView());
    return Results.Json(body);
});
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
app.MapOpenApi();
app.UseSwaggerUI(options =>
{
    options.SwaggerEndpoint("/openapi/v1.json", "api_v2");
});

app.Run();
