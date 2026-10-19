using api_v2.Application.Accounts;
using api_v2.Application.Auth;
using api_v2.Application.Backups;
using api_v2.Application.Health;
using api_v2.Application.History;
using api_v2.Application.Industries;
using api_v2.Application.Jobs;
using api_v2.Application.Me;
using api_v2.Application.Profile;
using api_v2.Application.Requests;
using api_v2.Application.Rules;
using api_v2.Application.Scratchpad;
using api_v2.Application.Settings;
using api_v2.Application.Tables;
using Microsoft.Extensions.DependencyInjection;

namespace api_v2.Application;

public static class DependencyInjection
{
    // The use cases. The ports they ask for are wired by AddInfrastructure, the settings records by the host.
    public static IServiceCollection AddApplication(this IServiceCollection services)
    {
        // State every request shares: whether the databases are up, the retention setting, the rules in use and the
        // wrong password count per name
        services.AddSingleton<DatabaseStatus>();
        services.AddSingleton<SettingsService>();
        services.AddSingleton<RulesService>();
        services.AddSingleton<LoginFailures>();
        services.AddSingleton<HistoryCheck>();

        // Scoped because the stores they call work through the scoped database context
        services.AddScoped<IndustryService>();
        services.AddScoped<UserTableService>();
        services.AddScoped<HistoryService>();
        services.AddScoped<RulesAdminService>();
        services.AddScoped<RuleChanges>();
        services.AddScoped<SettingsFileService>();
        services.AddScoped<BackupPreview>();
        services.AddScoped<AuthService>();
        services.AddScoped<AccountsAdminService>();
        services.AddScoped<UserAdminService>();
        services.AddScoped<ScratchpadService>();
        services.AddScoped<ScratchFileService>();
        services.AddScoped<MeService>();
        services.AddScoped<ProfileService>();
        services.AddScoped<RequestService>();

        // The background jobs' work, run on a timer by Infrastructure/Hosted
        services.AddScoped<ScratchFileSweep>();
        services.AddScoped<TableBinSweep>();
        return services;
    }
}
