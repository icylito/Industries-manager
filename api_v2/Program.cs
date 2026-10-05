using api_v2.Model;
using api_v2.Endpoints;
using Microsoft.OpenApi;
using Microsoft.EntityFrameworkCore;
using static Microsoft.OpenApi.OpenApiSpecVersion;
using api_v2.Data;
using api_v2.Auth;
using api_v2.Rules;


var builder = WebApplication.CreateBuilder(args);
builder.Services.AddCors(options => options.AddPolicy("Angular", policy => 
policy.WithOrigins("http://localhost:4200").AllowAnyHeader().AllowAnyMethod()));
builder.Services.AddValidation(); // Validating all the required, range, and length in Dtos folder
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

// Collector copies, versioned rules, and who is making the request (no login yet, see Auth/CurrentUser.cs)
builder.Services.AddSingleton<CollectorStore>();
builder.Services.AddSingleton<RulesService>();
builder.Services.AddScoped<ICurrentUser, NoAuthUser>();

var app = builder.Build();
app.UseCors("Angular");

// Always 200 so the frontend can read the state, the body says if the database is usable
app.MapGet("/health", (DatabaseStatus status) => Results.Ok(status.Snapshot()));
app.MapIndustries();
app.MapSchema();
app.MapOpenApi();
app.UseSwaggerUI(options =>
{
    options.SwaggerEndpoint("/openapi/v1.json", "api_v2");
});

app.Run();
