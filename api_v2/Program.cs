// The composition root. Each layer in backend/ registers its own part: the use cases (Application), what the ports
// are implemented with (Infrastructure), and the routes (Presentation). What stays here is the host itself: logging,
// CORS, Kestrel's limits, compression, https and the OpenAPI page.
using api_v2.Application;
using api_v2.Infrastructure;
using api_v2.Presentation;

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
// No body type carries validation attributes today, so this checks nothing yet; it is kept so one added later works
builder.Services.AddValidation();
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
builder.Services.AddOpenApi(options => options.OpenApiVersion = Microsoft.OpenApi.OpenApiSpecVersion.OpenApi3_0);

builder.Services.AddApplication();
builder.Services.AddInfrastructure(builder.Configuration);
builder.Services.AddPresentation(builder.Configuration);

// Https:Required turns http into a redirect to https and adds HSTS. Off by default so a fresh clone runs with no certificate,
// start.bat https turns it on together with the https launch profile. See README, Https.
var httpsRequired = builder.Configuration.GetValue("Https:Required", false);
if (httpsRequired)
{
    builder.Services.AddHttpsRedirection(options => options.HttpsPort = builder.Configuration.GetValue<int?>("Https:Port") ?? 7165);
}

var app = builder.Build();

app.Services.PrepareInfrastructure();

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

// backend/Presentation/Errors/ApiExceptionHandler.cs answers and logs every exception a request throws
app.UseExceptionHandler();

// start.bat share puts the page server in front of the API. It says who the real caller is, so the sign in limit counts each
// device on its own. Only trusted from this PC (loopback), the default for ForwardedHeaders.
app.UseForwardedHeaders(new ForwardedHeadersOptions { ForwardedHeaders = Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedFor });
app.UseResponseCompression();
app.UseCors("Angular");
app.UseRateLimiter();

app.MapPresentation();
app.MapOpenApi();
app.UseSwaggerUI(options =>
{
    options.SwaggerEndpoint("/openapi/v1.json", "api_v2");
});

app.Run();
