using System.Collections.Concurrent;
using System.Security.Cryptography;
using api_v2.Infrastructure.Security;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Npgsql;

namespace api_v2.Tests.Smoke;

// The real API host over a throwaway Postgres. Only the backup key wrapping is swapped, because Windows DPAPI is the
// one piece that can't run everywhere; everything else is what start.bat runs. SMOKE_PG names the server (default
// the docker database on 5433). The two databases are dropped and made fresh on every run, and the folders the API
// writes to sit in a temp folder, so nothing a person uses is touched.
public sealed class SmokeHost : WebApplicationFactory<Program>
{
    public const string MainDb = "smoke_main";
    public const string CollectorDb = "smoke_collector";

    private static readonly string Server = Environment.GetEnvironmentVariable("SMOKE_PG")
        ?? "Host=localhost;Port=5433;Username=postgres;Password=postgres";

    public string Folder { get; } = Path.Combine(Path.GetTempPath(), "api_v2-smoke-" + Guid.NewGuid().ToString("N")[..8]);
    public LogCapture Logs { get; } = new();

    public SmokeHost()
    {
        Directory.CreateDirectory(Folder);
        using var connection = new NpgsqlConnection(new NpgsqlConnectionStringBuilder(Server) { Database = "postgres" }.ConnectionString);
        connection.Open();
        foreach (var db in new[] { MainDb, CollectorDb })
        {
            using var drop = new NpgsqlCommand($"DROP DATABASE IF EXISTS \"{db}\" WITH (FORCE)", connection);
            drop.ExecuteNonQuery();
            using var create = new NpgsqlCommand($"CREATE DATABASE \"{db}\"", connection);
            create.ExecuteNonQuery();
        }
    }

    private static string Db(string name) => new NpgsqlConnectionStringBuilder(Server) { Database = name }.ConnectionString;

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Smoke");
        builder.UseSetting("ConnectionStrings:ApiV2", Db(MainDb));
        builder.UseSetting("ConnectionStrings:Collector", Db(CollectorDb));
        builder.UseSetting("Backup:Folder", Path.Combine(Folder, "backups"));
        builder.UseSetting("Backup:SigningKeyFile", Path.Combine(Folder, "backup-key", "backup-signing.key"));
        builder.UseSetting("Scratchpad:Files", Path.Combine(Folder, "scratchpad-files"));
        builder.UseSetting("UserTables:Mirror", Path.Combine(Folder, "user-tables"));
        builder.ConfigureLogging(logging => logging.AddProvider(Logs));
        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IKeyProtector>();
            services.AddSingleton<IKeyProtector, TestKeyProtector>();
        });
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        try { Directory.Delete(Folder, recursive: true); } catch (IOException) { }
    }
}

// Stands in for DPAPI: the wrapped copy is the key with a marker in front, and a blob without the marker reads as a
// key from another computer, the same CryptographicException DPAPI gives
public sealed class TestKeyProtector : IKeyProtector
{
    private static readonly byte[] Marker = "smoke-key:"u8.ToArray();

    public byte[] Protect(byte[] keys) => [.. Marker, .. keys];

    public byte[] Unprotect(byte[] wrapped) => wrapped.AsSpan().StartsWith(Marker)
        ? wrapped[Marker.Length..]
        : throw new CryptographicException("Not this computer's key");
}

// Keeps every log line's named values, so the test can read the admin password the API prints once at first start
public sealed class LogCapture : ILoggerProvider
{
    public ConcurrentQueue<(string Category, LogLevel Level, string Text, IReadOnlyDictionary<string, object?> Values)> Lines { get; } = new();

    public ILogger CreateLogger(string categoryName) => new Writer(this, categoryName);

    public void Dispose() { }

    public string? Value(string name) => Lines.Reverse()
        .Select(l => l.Values.TryGetValue(name, out var v) ? v?.ToString() : null)
        .FirstOrDefault(v => v is not null);

    private sealed class Writer(LogCapture capture, string category) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            var values = new Dictionary<string, object?>();
            if (state is IEnumerable<KeyValuePair<string, object?>> pairs)
            {
                foreach (var (key, value) in pairs) values[key] = value;
            }
            capture.Lines.Enqueue((category, logLevel, formatter(state, exception), values));
        }
    }
}
