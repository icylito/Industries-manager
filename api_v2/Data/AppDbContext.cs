using api_v2.Model;
using Microsoft.EntityFrameworkCore;
namespace api_v2.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<Industry> Industries => Set<Industry>();
    public DbSet<RuleVersion> RuleVersions => Set<RuleVersion>();
    public DbSet<DevRequest> Requests => Set<DevRequest>();
    public DbSet<AppSetting> Settings => Set<AppSetting>();
    public DbSet<User> Users => Set<User>();
    public DbSet<Session> Sessions => Set<Session>();
    public DbSet<UserNote> UserNotes => Set<UserNote>();
    public DbSet<ScratchBoard> ScratchBoards => Set<ScratchBoard>();
    public DbSet<ScratchFile> ScratchFiles => Set<ScratchFile>();
    public DbSet<ScratchTray> ScratchTrays => Set<ScratchTray>();
    public DbSet<UserSettings> UserSettings => Set<UserSettings>();
    public DbSet<UserTable> UserTables => Set<UserTable>();
    public DbSet<UserTableRow> UserTableRows => Set<UserTableRow>();

    // Both parts of the model: the data (DataModel) and what is always current (StateModel). The app reads and writes
    // through this one context; each part migrates on its own, see MigrationContexts.cs.
    protected override void OnModelCreating(ModelBuilder model)
    {
        DataModel.Configure(model);
        StateModel.Configure(model);
    }
}
