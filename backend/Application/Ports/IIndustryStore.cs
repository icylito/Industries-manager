using api_v2.Domain.Entities;

namespace api_v2.Application.Ports;

// The live Industries table. The store owns the queries and the unit of work; the use cases own the order
// of the steps and the rules.
public interface IIndustryStore
{
    Task<IReadOnlyList<Industry>> AllAsync(CancellationToken ct);

    // How many rows the table holds now, which is what a restore would replace
    Task<int> CountAsync(CancellationToken ct);

    // The Scratchpad rail searches by name so it never pulls the whole table down
    Task<IReadOnlyList<Industry>> SearchAsync(string needle, int take, CancellationToken ct);

    // The few most expensive rows, highest price first
    Task<IReadOnlyList<Industry>> TopByPriceAsync(int take, CancellationToken ct);

    Task<IReadOnlyList<Industry>> ByIdsAsync(IReadOnlyList<int> ids, CancellationToken ct);

    // Tracked, because edits and deletes change the row they read
    Task<Industry?> FindAsync(int id, CancellationToken ct);

    void Add(Industry row);

    void Remove(Industry row);

    // False when the unique name index caught a duplicate, which the check before it can miss.
    // A row another request deleted meanwhile throws RowGoneException.
    Task<bool> SaveAsync(CancellationToken ct);

    // Rows flagged as copies of the given row
    Task<IReadOnlyList<Industry>> FlaggedAgainstAsync(int ownerId, CancellationToken ct);

    // The id of the row that owns the name now, ignoring the given ids, or null when nobody does
    Task<int?> OwnerOfNameAsync(string name, IReadOnlyCollection<int> excluding, CancellationToken ct);
}
