using api_v2.Domain.Entities;

namespace api_v2.Application.Ports;

// The account rows an admin manages, and the notes kept about them. The use case owns the order of the
// steps and the wording; the store owns the queries and the unit of work.
public interface IUserAdminStore
{
    // Who has a note, then every account by username, the order the people list reads them in
    Task<(IReadOnlyCollection<int> Noted, IReadOnlyList<User> People)> ListAsync(CancellationToken ct);

    Task<IReadOnlyList<UserNote>> NotesAsync(int userId, CancellationToken ct);

    Task<bool> ExistsAsync(int userId, CancellationToken ct);

    // Tracked, because the admin endpoints change the row they read
    Task<User?> FindAsync(int id, CancellationToken ct);

    void AddUser(User user);

    void RemoveUser(User user);

    void AddNote(UserNote note);

    // False when the unique username index caught a duplicate, which the check before it can miss.
    // Any other save error is thrown, the same as before.
    Task<bool> TrySaveAsync(CancellationToken ct);

    Task SaveAsync(CancellationToken ct);

    Task DeleteSessionsAsync(int userId, CancellationToken ct);

    // Whether anyone else can still sign in as an admin, which the last-admin checks ask
    Task<bool> AnyOtherEnabledAdminAsync(int userId, CancellationToken ct);

    // Deletes the note and answers how many rows went, so one already gone reads as not found
    Task<int> DeleteNoteAsync(int noteId, int userId, CancellationToken ct);
}
