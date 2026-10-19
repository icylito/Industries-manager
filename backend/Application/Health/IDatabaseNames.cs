namespace api_v2.Application.Health;

// Host, port and database name of the live and the history database, for /health. Never the password.
public sealed record DatabaseName(string Host, int Port, string? Database);

public sealed record DatabaseNames(DatabaseName Live, DatabaseName History);

public interface IDatabaseNames
{
    DatabaseNames Describe();
}
