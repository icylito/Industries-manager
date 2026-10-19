using api_v2.Application.Health;
using api_v2.Application.Ports;
using api_v2.Application.Settings;
using api_v2.Infrastructure.Backups;
using api_v2.Infrastructure.Configuration;
using api_v2.Infrastructure.Files;
using api_v2.Infrastructure.Hosted;
using api_v2.Infrastructure.Persistence;
using api_v2.Infrastructure.Security;
using api_v2.Infrastructure.Startup;
using Microsoft.EntityFrameworkCore;

namespace api_v2.Infrastructure;

public static class DependencyInjection
{
    // Every port wired to what implements it, the databases, the files on disk and the background jobs. This is
    // also the one place appsettings is read into the settings records the use cases take.
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration config)
    {
        AddSettings(services, config);

        var connections = DatabaseConnections.From(config);
        services.AddSingleton(connections);
        services.AddSingleton<IDatabaseNames, DatabaseNamesFromSettings>();
        // EnableRetryOnFailure retries a query up to 3 times on transient errors like a dropped connection
        services.AddDbContext<AppDbContext>(options => options.UseNpgsql(connections.Main,
            npgsql => npgsql.EnableRetryOnFailure(maxRetryCount: 3, maxRetryDelay: TimeSpan.FromSeconds(5), errorCodesToAdd: null)));
        // The two migration chains, only used to migrate: the data's, and what is always current with its own history table
        services.AddDbContext<DataMigrationsContext>(options => options.UseNpgsql(connections.Main));
        services.AddDbContext<StateMigrationsContext>(options => options.UseNpgsql(connections.Main,
            npgsql => npgsql.MigrationsHistoryTable(StateMigrationsContext.HistoryTable)));
        // Auto migration, applies pending migrations on startup and tracks the result for /health
        services.AddHostedService<MigrationService>();
        services.AddSingleton<IStorageErrors, StorageErrors>();

        // Collector copies and the advisory locks every change takes turns through
        services.AddSingleton<CollectorStore>();
        services.AddSingleton<ICollectorStore>(s => s.GetRequiredService<CollectorStore>());
        services.AddSingleton<AppLocks>();
        services.AddSingleton<IAppLocks>(s => s.GetRequiredService<AppLocks>());

        // The live tables. Scoped because they work through the scoped AppDbContext.
        services.AddScoped<IIndustryStore, IndustryStore>();
        services.AddScoped<INameIndex, NameIndex>();
        services.AddScoped<IRulesStore, RulesStore>();
        services.AddScoped<ISettingsStore, SettingsStore>();
        services.AddScoped<IUserTablesStore, UserTablesStore>();
        services.AddScoped<IScratchpadStore, ScratchpadStore>();
        services.AddScoped<IScratchFilesStore, ScratchFilesStore>();
        services.AddScoped<IAccounts, AccountStore>();
        services.AddScoped<IUserAdminStore, UserAdminStore>();
        services.AddScoped<IMeStore, MeStore>();
        services.AddScoped<IProfileStore, ProfileStore>();
        services.AddScoped<IRequestsStore, RequestStore>();
        services.AddScoped<IHistoryRestoreRunner, HistoryRestoreRunner>();
        services.AddSingleton<TableWriter>();
        services.AddSingleton<ITableWriter>(s => s.GetRequiredService<TableWriter>());
        services.AddSingleton<ISectorConfig, SectorConfigFile>();

        // Files on disk: uploaded Scratchpad files, and the readable JSON copy of every table from the Tables page
        services.AddSingleton<ScratchFileStore>();
        services.AddSingleton<IScratchFiles>(s => s.GetRequiredService<ScratchFileStore>());
        services.AddSingleton<UserTableMirror>();
        services.AddSingleton<IUserTableMirror>(s => s.GetRequiredService<UserTableMirror>());

        // Backups, signed so only this app's own can be dropped back in, with the key wrapped for this computer
        services.AddSingleton(_ => KeyProtection.ForThisComputer());
        services.AddSingleton<BackupSigner>();
        services.AddSingleton<BackupService>();
        services.AddSingleton<IBackupService>(s => s.GetRequiredService<BackupService>());
        services.AddSingleton<BackupRestore>();
        services.AddSingleton<IBackupRestore>(s => s.GetRequiredService<BackupRestore>());

        // Who is signed in comes from the token the page sends, and how passwords are checked
        services.AddHttpContextAccessor();
        services.AddScoped<ICurrentUser, SessionUser>();
        services.AddSingleton<IPasswordHasher, PasswordHasherAdapter>();

        // The timers: nightly backups, the Scratchpad file sweep, the table bin, and the history database watch
        services.AddHostedService<BackupScheduler>();
        services.AddHostedService<ScratchFileSweeper>();
        services.AddHostedService<TableBinSweeper>();
        services.AddHostedService<HistoryMonitor>();
        return services;
    }

    // The folders and the backup key are made at startup, so a bad path or a denied folder fails then instead of
    // on the first upload, and the first backup doesn't wait on the key
    public static void PrepareInfrastructure(this IServiceProvider services)
    {
        services.GetRequiredService<ScratchFileStore>();
        services.GetRequiredService<UserTableMirror>();
        services.GetRequiredService<BackupSigner>();
    }

    private static void AddSettings(IServiceCollection services, IConfiguration config)
    {
        services.AddSingleton(new RetentionDefaults(config.GetValue<int?>("Collector:KeepVersions"), config.GetValue<int?>("Collector:KeepDays")));
        services.AddSingleton(new LoginLimits(config.GetValue("Auth:FailedTriesPerName", 10), config.GetValue("Auth:FailedTriesWindowMinutes", 15)));
        // Read on every request, as before, so a change to appsettings.json applies without a restart
        services.AddTransient(s => new BackupUploadLimit(s.GetRequiredService<IConfiguration>().GetValue("Backup:MaxUploadMb", 2048)));
        services.AddTransient(s => new GuestAccess(s.GetRequiredService<IConfiguration>().GetValue("Auth:GuestCanView", true)));
    }
}
