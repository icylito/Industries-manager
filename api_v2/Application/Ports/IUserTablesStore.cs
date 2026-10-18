namespace api_v2.Application.Ports;

// A table that has been in the bin long enough to be removed for good
public record UserTableExpired(int Id, string Name);

// The tables from the Tables page: removing the ones that have sat in the bin past the limit
public interface IUserTablesStore
{
    Task<IReadOnlyList<UserTableExpired>> DeleteExpiredAsync(DateTimeOffset cutoff, CancellationToken ct);
}
