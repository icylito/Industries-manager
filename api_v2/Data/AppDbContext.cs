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

    protected override void OnModelCreating(ModelBuilder model)
    {
        model.Entity<RuleVersion>().Property(r => r.Fields).HasColumnType("jsonb");
        model.Entity<Industry>().Property(i => i.Extra).HasColumnType("jsonb");
        model.Entity<AppSetting>().HasKey(s => s.Key);
        model.Entity<AppSetting>().Property(s => s.Value).HasColumnType("jsonb");
        model.Entity<DevRequest>().HasIndex(r => r.Status);
        model.Entity<User>().Property(u => u.Username).HasMaxLength(32);
        model.Entity<User>().HasIndex(u => u.Username).IsUnique();
        model.Entity<User>().ToTable(t => t.HasCheckConstraint("CK_Users_Role", "\"Role\" IN ('admin', 'normal')"));
        model.Entity<Session>().HasIndex(s => s.TokenHash).IsUnique();
        model.Entity<Session>().HasIndex(s => s.UserId);
        model.Entity<Session>().HasOne(s => s.User).WithMany().HasForeignKey(s => s.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}
