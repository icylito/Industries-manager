using Npgsql;

namespace api_v2.Data;

// Main holds the live tables, Collector keeps old versions so nothing gets lost
public record DatabaseConnections(string Main, string Collector, bool UsingDockerDefault)
{
    // Matches docker-compose.yml, so a fresh clone works with no settings file
    public const string DockerDefault = "Host=localhost;Port=5433;Database=main;Username=postgres;Password=postgres";

    public static DatabaseConnections From(IConfiguration config)
    {
        var main = config.GetConnectionString("ApiV2");
        var usingDefault = string.IsNullOrWhiteSpace(main);
        if (usingDefault)
        {
            main = DockerDefault;
        }

        // No Collector setting means same server and login as main, in a database called collector
        var collector = config.GetConnectionString("Collector");
        if (string.IsNullOrWhiteSpace(collector))
        {
            collector = new NpgsqlConnectionStringBuilder(main) { Database = "collector" }.ConnectionString;
        }

        return new DatabaseConnections(main!, collector, usingDefault);
    }
}
