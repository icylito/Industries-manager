using api_v2.Application.Auth;
using api_v2.Application.Ports;
using api_v2.Domain.Accounts;
using api_v2.Domain.Entities;

namespace api_v2.Application.Accounts;

// The accounts an admin looks after: the people list, making an account with a temporary password, resetting
// one, renaming, switching off and deleting one, and the notes kept about them. The username checks and the
// clash refresh stay with AccountsAdminService, and the password text is made and hashed behind IPasswordHasher.
public class UserAdminService(IUserAdminStore store, AccountsAdminService accounts, IPasswordHasher hasher)
{
    // A note is plain text, trimmed, and capped so one cannot grow without limit
    private const int NoteMax = 2000;

    public async Task<IReadOnlyList<AdminUserRow>> ListAsync(CancellationToken ct)
    {
        var (noted, people) = await store.ListAsync(ct);
        var withNotes = noted.ToHashSet();
        return people.Select(u => new AdminUserRow(u, withNotes.Contains(u.Id))).ToList();
    }

    // Makes the account with a random password that's shown once. The person has to pick their own at first sign in.
    public async Task<CreateUserResult> CreateAsync(
        string? rawUsername, string? role, string createdBy, CancellationToken ct)
    {
        var problem = UserService.CheckUsername(rawUsername, out var username);
        if (problem is not null)
        {
            return new CreateUserResult.Invalid(new Dictionary<string, string[]> { ["username"] = [problem] });
        }
        var newRole = role ?? Roles.Normal;
        if (!Roles.IsValid(newRole))
        {
            return new CreateUserResult.Invalid(new Dictionary<string, string[]> { ["role"] = [Roles.InvalidMessage] });
        }
        if (await accounts.UsernameTakenAsync(username, null, ct))
        {
            return new CreateUserResult.NameTaken();
        }

        var password = hasher.Generate();
        var user = new User
        {
            Username = username,
            PasswordHash = hasher.Hash(password),
            Role = newRole,
            MustChangePassword = true,
            CreatedAt = DateTimeOffset.UtcNow,
            CreatedBy = createdBy
        };
        store.AddUser(user);
        if (!await store.TrySaveAsync(ct))
        {
            return new CreateUserResult.NameTaken();
        }
        return new CreateUserResult.Created(user, password);
    }

    // A new random password for someone who forgot theirs. Signs them out everywhere.
    public async Task<ResetPasswordResult> ResetPasswordAsync(int id, int adminId, CancellationToken ct)
    {
        var user = await store.FindAsync(id, ct);
        if (user is null) return new ResetPasswordResult.NotFound();
        if (user.Id == adminId) return new ResetPasswordResult.OwnAccount();

        var password = hasher.Generate();
        user.PasswordHash = hasher.Hash(password);
        user.MustChangePassword = true;
        user.PasswordChangedAt = DateTimeOffset.UtcNow;
        await store.SaveAsync(ct);
        await store.DeleteSessionsAsync(id, ct);
        return new ResetPasswordResult.Reset(user, password);
    }

    // Make someone admin or normal, turn the account off or on, or change their username.
    // A rename changes the name from here on: what History already recorded keeps the name it was written with.
    public async Task<UpdateUserResult> UpdateAsync(
        int id, int adminId, string? rawUsername, string? role, bool? disabled, CancellationToken ct)
    {
        var user = await store.FindAsync(id, ct);
        if (user is null) return new UpdateUserResult.NotFound();
        if (user.Id == adminId) return new UpdateUserResult.OwnAccount();
        if (role is not null && !Roles.IsValid(role))
        {
            return new UpdateUserResult.Invalid(new Dictionary<string, string[]> { ["role"] = [Roles.InvalidMessage] });
        }

        string? renamed = null;
        if (rawUsername is not null)
        {
            var problem = UserService.CheckUsername(rawUsername, out var clean);
            if (problem is not null)
            {
                return new UpdateUserResult.Invalid(new Dictionary<string, string[]> { ["username"] = [problem] });
            }
            if (!string.Equals(clean, user.Username, StringComparison.Ordinal))
            {
                if (await accounts.UsernameTakenAsync(clean, id, ct))
                {
                    return new UpdateUserResult.NameTaken();
                }
                renamed = clean;
                // The new name was checked against everyone, so this account clashes with no one now
                user.NameClash = false;
            }
        }

        var newRole = role ?? user.Role;
        var newDisabled = disabled ?? user.Disabled;
        var losesAdmin = user.Role == Roles.Admin && !user.Disabled && (newRole != Roles.Admin || newDisabled);
        if (losesAdmin && !await store.AnyOtherEnabledAdminAsync(id, ct))
        {
            return new UpdateUserResult.LastAdmin();
        }

        user.Role = newRole;
        user.Disabled = newDisabled;
        if (renamed is not null) user.Username = renamed;
        if (!await store.TrySaveAsync(ct))
        {
            return new UpdateUserResult.NameTaken();
        }
        if (newDisabled)
        {
            await store.DeleteSessionsAsync(id, ct);
        }
        // A new name can free an account that clashed with the old one
        if (renamed is not null) await accounts.RefreshNameClashesAsync(ct);
        return new UpdateUserResult.Updated(user);
    }

    // Deletes an account for good. What History already recorded keeps the name, so old entries still read right.
    public async Task<DeleteUserResult> DeleteAsync(int id, int adminId, CancellationToken ct)
    {
        var user = await store.FindAsync(id, ct);
        if (user is null) return new DeleteUserResult.NotFound();
        if (user.Id == adminId) return new DeleteUserResult.OwnAccount();
        // With no admin left the API makes a fresh one on the next start, so this is refused instead
        if (user.Role == Roles.Admin && !user.Disabled && !await store.AnyOtherEnabledAdminAsync(id, ct))
        {
            return new DeleteUserResult.LastAdmin();
        }

        store.RemoveUser(user);
        await store.SaveAsync(ct);
        // An account that clashed with this one doesn't any more
        await accounts.RefreshNameClashesAsync(ct);
        return new DeleteUserResult.Deleted(user);
    }

    // Notes an admin keeps about an account. They are only ever served from here, and only to an admin.
    public async Task<ListNotesResult> NotesAsync(int id, CancellationToken ct)
    {
        if (!await store.ExistsAsync(id, ct)) return new ListNotesResult.NotFound();
        return new ListNotesResult.Found(await store.NotesAsync(id, ct));
    }

    public async Task<AddNoteResult> AddNoteAsync(int id, string? rawText, string createdBy, CancellationToken ct)
    {
        if (!await store.ExistsAsync(id, ct)) return new AddNoteResult.NotFound();
        var text = (rawText ?? string.Empty).Trim();
        if (text.Length == 0)
        {
            return new AddNoteResult.Invalid(new Dictionary<string, string[]> { ["text"] = ["Type the note first"] });
        }
        if (text.Length > NoteMax)
        {
            return new AddNoteResult.Invalid(new Dictionary<string, string[]> { ["text"] = [$"A note can be at most {NoteMax} characters"] });
        }

        var note = new UserNote { UserId = id, Text = text, CreatedBy = createdBy, CreatedAt = DateTimeOffset.UtcNow };
        store.AddNote(note);
        await store.SaveAsync(ct);
        return new AddNoteResult.Added(note);
    }

    // For a note that should not have been written. Removing it is the only edit, a note is a record of what was said.
    public async Task<DeleteNoteResult> DeleteNoteAsync(int id, int noteId, CancellationToken ct)
    {
        var removed = await store.DeleteNoteAsync(noteId, id, ct);
        return removed == 0 ? new DeleteNoteResult.NotFound() : new DeleteNoteResult.Deleted();
    }
}
