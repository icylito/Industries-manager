using api_v2.Model;
using Microsoft.EntityFrameworkCore;
namespace api_v2.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : 
DbContext(options){
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

    protected override void OnModelCreating(ModelBuilder model)
    {
        model.Entity<RuleVersion>().Property(r => r.Fields).HasColumnType("jsonb");
        model.Entity<Industry>().Property(i => i.Extra).HasColumnType("jsonb");
        model.Entity<AppSetting>().HasKey(s => s.Key);
        model.Entity<AppSetting>().Property(s => s.Value).HasColumnType("jsonb");
        model.Entity<DevRequest>().HasIndex(r => r.Status);
        model.Entity<User>().Property(u => u.Username).HasMaxLength(32);
        model.Entity<User>().HasIndex(u => u.Username).IsUnique();
        model.Entity<User>().ToTable(t => t.HasCheckConstraint("CK_Users_Role", "\"Role\" IN ('admin', 'manager', 'normal')"));
        model.Entity<Session>().HasIndex(s => s.TokenHash).IsUnique();
        model.Entity<Session>().HasIndex(s => s.UserId);
        model.Entity<Session>().HasOne(s => s.User).WithMany().HasForeignKey(s => s.UserId).OnDelete(DeleteBehavior.Cascade);
        // A note an admin keeps about an account. Deleting the account takes its notes with it, so none are left behind.
        model.Entity<UserNote>().Property(n => n.Text).HasMaxLength(2000);
        model.Entity<UserNote>().HasIndex(n => n.UserId);
        model.Entity<UserNote>().HasOne<User>().WithMany().HasForeignKey(n => n.UserId).OnDelete(DeleteBehavior.Cascade);
        // Scratchpad boards, several per person, each the whole board as JSON so new kinds of thing need no
        // migration. Listed newest first per person. Deleting the account takes its boards.
        model.Entity<ScratchBoard>().Property(b => b.Name).HasMaxLength(60).HasDefaultValue("My board");
        model.Entity<ScratchBoard>().Property(b => b.Pinned).HasDefaultValue(false);
        model.Entity<ScratchBoard>().Property(b => b.Document).HasColumnType("jsonb");
        model.Entity<ScratchBoard>().Property(b => b.View).HasColumnType("jsonb");
        model.Entity<ScratchBoard>().HasIndex(b => new { b.UserId, b.UpdatedAt });
        model.Entity<ScratchBoard>().HasOne<User>().WithMany().HasForeignKey(b => b.UserId).OnDelete(DeleteBehavior.Cascade);
        // A file a person uploaded to the Scratchpad. Name is only shown on the card; StoredName is the only
        // name on disk (a GUID plus extension) and is unique. Deleting the account takes its files.
        model.Entity<ScratchFile>().Property(f => f.Name).HasMaxLength(260);
        model.Entity<ScratchFile>().Property(f => f.ContentType).HasMaxLength(120);
        model.Entity<ScratchFile>().Property(f => f.StoredName).HasMaxLength(80);
        model.Entity<ScratchFile>().HasIndex(f => f.UserId);
        model.Entity<ScratchFile>().HasIndex(f => f.StoredName).IsUnique();
        model.Entity<ScratchFile>().HasOne<User>().WithMany().HasForeignKey(f => f.UserId).OnDelete(DeleteBehavior.Cascade);
        // The carry tray and a person's own settings: one row each, keyed by the person, gone with the account
        model.Entity<ScratchTray>().HasKey(t => t.UserId);
        model.Entity<ScratchTray>().Property(t => t.Items).HasColumnType("jsonb");
        model.Entity<ScratchTray>().HasOne<User>().WithMany().HasForeignKey(t => t.UserId).OnDelete(DeleteBehavior.Cascade);
        model.Entity<UserSettings>().HasKey(s => s.UserId);
        model.Entity<UserSettings>().Property(s => s.Shortcuts).HasColumnType("jsonb");
        model.Entity<UserSettings>().Property(s => s.Mouse).HasColumnType("jsonb");
        model.Entity<UserSettings>().Property(s => s.Theme).HasMaxLength(8);
        model.Entity<UserSettings>().ToTable(t => t.HasCheckConstraint("CK_UserSettings_Theme", "\"Theme\" IS NULL OR \"Theme\" IN ('light', 'dark')"));
        model.Entity<UserSettings>().HasOne<User>().WithMany().HasForeignKey(s => s.UserId).OnDelete(DeleteBehavior.Cascade);
        // Tables made on the Tables page. Data, not real tables, so making one never needs a migration.
        // The unique name index ignores case and is in the migration as plain SQL, like the industries one.
        model.Entity<UserTable>().Property(t => t.Name).HasMaxLength(60);
        model.Entity<UserTable>().Property(t => t.Columns).HasColumnType("jsonb");
        model.Entity<UserTable>().Property(t => t.CreatedBy).HasMaxLength(32);
        model.Entity<UserTable>().Property(t => t.Version).IsConcurrencyToken();
        model.Entity<UserTable>().HasIndex(t => t.DeletedAt);
        model.Entity<UserTableRow>().Property(r => r.Data).HasColumnType("jsonb");
        model.Entity<UserTableRow>().Property(r => r.CreatedBy).HasMaxLength(32);
        model.Entity<UserTableRow>().HasIndex(r => r.TableId);
        model.Entity<UserTableRow>().HasOne<UserTable>().WithMany().HasForeignKey(r => r.TableId).OnDelete(DeleteBehavior.Cascade);
    }
}
