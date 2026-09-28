using api_v2.Model;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure.Internal;
using Microsoft.Extensions.Options;
namespace api_v2.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : 
DbContext(options){
    public DbSet<Industry> Industries => Set<Industry>();
}