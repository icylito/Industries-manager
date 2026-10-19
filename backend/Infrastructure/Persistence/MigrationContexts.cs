using Microsoft.EntityFrameworkCore;
namespace api_v2.Infrastructure.Persistence;

// The two migration chains. Each builds only its own part of the model and keeps its own migration history, so
// going back or forward on one can never touch the other's tables. Only used to migrate; the app itself reads and
// writes through AppDbContext, which has both parts, so one save can still span them (a field change closing its requests).
public sealed class DataMigrationsContext(DbContextOptions<DataMigrationsContext> options) : DbContext(options)
{
    protected override void OnModelCreating(ModelBuilder model) => DataModel.Configure(model);
}

public sealed class StateMigrationsContext(DbContextOptions<StateMigrationsContext> options) : DbContext(options)
{
    public const string HistoryTable = "__StateMigrationsHistory";
    protected override void OnModelCreating(ModelBuilder model) => StateModel.Configure(model);
}
