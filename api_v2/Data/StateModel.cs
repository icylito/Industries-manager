using api_v2.Model;
using Microsoft.EntityFrameworkCore;
namespace api_v2.Data;

// What is always current: accounts, sign ins, notes, personal settings, the Scratchpad, requests and app settings.
// None of it travels in time: rolling the data back or restoring a backup never touches these tables. They have
// their own migrations (Migrations/State, history in "__StateMigrationsHistory"), apart from the data's (DataModel).
public static class StateModel
{
    public static void Configure(ModelBuilder model)
    {
        // Named here rather than taken from AppDbContext's properties, so the state migrations name them the same
        model.Entity<AppSetting>().ToTable("Settings");
        model.Entity<DevRequest>().ToTable("Requests");
        model.Entity<Session>().ToTable("Sessions");
        model.Entity<UserNote>().ToTable("UserNotes");
        model.Entity<ScratchBoard>().ToTable("ScratchBoards");
        model.Entity<ScratchFile>().ToTable("ScratchFiles");
        model.Entity<ScratchTray>().ToTable("ScratchTrays");
        model.Entity<AppSetting>().HasKey(s => s.Key);
        model.Entity<AppSetting>().Property(s => s.Value).HasColumnType("jsonb");
        model.Entity<DevRequest>().HasIndex(r => r.Status);
        model.Entity<User>().Property(u => u.Username).HasMaxLength(32);
        model.Entity<User>().HasIndex(u => u.Username).IsUnique();
        model.Entity<User>().ToTable("Users", t => t.HasCheckConstraint("CK_Users_Role", "\"Role\" IN ('admin', 'manager', 'normal')"));
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
        model.Entity<UserSettings>().ToTable("UserSettings", t => t.HasCheckConstraint("CK_UserSettings_Theme", "\"Theme\" IS NULL OR \"Theme\" IN ('light', 'dark')"));
        model.Entity<UserSettings>().HasOne<User>().WithMany().HasForeignKey(s => s.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}
