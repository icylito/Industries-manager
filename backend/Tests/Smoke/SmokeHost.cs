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

// The real API host over its own Postgres databases. Only the backup key wrapping is swapped, because Windows DPAPI is
// the one piece that can't run everywhere; everything else is what start.bat runs. SMOKE_PG names the server (default
// the docker database on 5433). The databases (smoke_main, smoke_collector) and the folders the API writes to
// (api_v2-smoke in the temp folder) are kept from one run to the next, so a small change is checked without setting
// everything up again. SMOKE_FRESH=1 drops them and starts from an empty database, which is also what the first run
// does when they aren't there yet. Nothing a person uses is touched either way.
public sealed class SmokeHost : WebApplicationFactory<Program>
{
    public const string MainDb = "smoke_main";
    public const string CollectorDb = "smoke_collector";

    private static readonly string PgServer = Environment.GetEnvironmentVariable("SMOKE_PG")
        ?? "Host=localhost;Port=5433;Username=postgres;Password=postgres";

    private static readonly bool AskedFresh = Environment.GetEnvironmentVariable("SMOKE_FRESH") == "1";

    public string Folder { get; } = Path.Combine(Path.GetTempPath(), "api_v2-smoke");
    public LogCapture Logs { get; } = new();

    // True when this run starts from empty databases, so the API makes the first admin and prints its password
    public bool Fresh { get; }

    public SmokeHost()
    {
        using var connection = new NpgsqlConnection(new NpgsqlConnectionStringBuilder(PgServer) { Database = "postgres" }.ConnectionString);
        connection.Open();
        var missing = false;
        foreach (var db in new[] { MainDb, CollectorDb })
        {
            if (AskedFresh)
            {
                using var drop = new NpgsqlCommand($"DROP DATABASE IF EXISTS \"{db}\" WITH (FORCE)", connection);
                drop.ExecuteNonQuery();
            }
            using var exists = new NpgsqlCommand("SELECT 1 FROM pg_database WHERE datname = @name", connection);
            exists.Parameters.AddWithValue("name", db);
            if (exists.ExecuteScalar() is not null) continue;
            using var create = new NpgsqlCommand($"CREATE DATABASE \"{db}\"", connection);
            create.ExecuteNonQuery();
            missing = true;
        }
        Fresh = AskedFresh || missing;
        // The folders go with the databases: a new database with an old backup key or old files would not match
        if (Fresh && Directory.Exists(Folder)) Directory.Delete(Folder, recursive: true);
        Directory.CreateDirectory(Folder);
    }

    private static string Db(string name) => new NpgsqlConnectionStringBuilder(PgServer) { Database = name }.ConnectionString;

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
        // The databases and the folder stay for the next run, see the top of this file
        base.Dispose(disposing);
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
