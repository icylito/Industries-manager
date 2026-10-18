using api_v2.Domain.Entities;
using Microsoft.EntityFrameworkCore;
namespace api_v2.Infrastructure.Persistence;

// The data: the only tables that travel in time. Migrations, restores and History deal with these and nothing else.
// The app's context and the data migrations both build their model from here, so the two can never drift apart.
// Everything else is always current, see StateModel.
public static class DataModel
{
    public static void Configure(ModelBuilder model)
    {
        // Named here rather than taken from AppDbContext's properties, so the data migrations name them the same
        model.Entity<Industry>().ToTable("Industries");
        model.Entity<RuleVersion>().ToTable("RuleVersions");
        model.Entity<UserTable>().ToTable("UserTables");
        model.Entity<UserTableRow>().ToTable("UserTableRows");
        model.Entity<RuleVersion>().Property(r => r.Fields).HasColumnType("jsonb");
        model.Entity<Industry>().Property(i => i.Extra).HasColumnType("jsonb");
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
