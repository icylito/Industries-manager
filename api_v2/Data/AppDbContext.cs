using api_v2.Model;
using Microsoft.EntityFrameworkCore;
namespace api_v2.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : 
DbContext(options){
    public DbSet<Industry> Industries => Set<Industry>();
    public DbSet<RuleVersion> RuleVersions => Set<RuleVersion>();
    public DbSet<DevRequest> Requests => Set<DevRequest>();
    public DbSet<AppSetting> Settings => Set<AppSetting>();

    protected override void OnModelCreating(ModelBuilder model)
    {
        model.Entity<RuleVersion>().Property(r => r.Fields).HasColumnType("jsonb");
        model.Entity<Industry>().Property(i => i.Extra).HasColumnType("jsonb");
        model.Entity<AppSetting>().HasKey(s => s.Key);
        model.Entity<AppSetting>().Property(s => s.Value).HasColumnType("jsonb");
        model.Entity<DevRequest>().HasIndex(r => r.Status);
    }
}
