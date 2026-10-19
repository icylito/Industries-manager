using api_v2.Application.Accounts;
using api_v2.Application.Auth;
using api_v2.Application.Ports;
using api_v2.Domain.Entities;
using api_v2.Presentation.Authorization;
using api_v2.Presentation.Contracts;

namespace api_v2.Presentation.Endpoints;

// Accounts, admin only. There is no sign up, so nobody else on the network can make one. Every endpoint binds
// its input, calls one use case in Application/Accounts and turns the answer into an HTTP result.
public static class UserEndpoints
{
    public static void MapUsers(this WebApplication app)
    {
        var users = app.MapGroup("/users").RequireDatabaseReady().RequireAdmin();

        // The people list also says who has a note, so an admin can see one exists without opening anything.
        // Notes are not part of UserService.ToDto on purpose: that shape is what /auth/me hands a person about themselves.
        users.MapGet("/", async (UserAdminService accounts, CancellationToken ct) =>
            Results.Ok((await accounts.ListAsync(ct)).Select(row => ToAdminDto(row.Row, row.HasNotes))));

        // Makes the account with a random password that's shown once. The person has to pick their own at first sign in.
        users.MapPost("/", async (NewUserBody body, UserAdminService accounts, ICurrentUser admin, CancellationToken ct) =>
        {
            var result = await accounts.CreateAsync(body.Username, body.Role, admin.Name, ct);
            return result switch
            {
                CreateUserResult.Created created => Results.Created($"/users/{created.Row.Id}",
                    new { User = UserService.ToDto(created.Row), TemporaryPassword = created.TemporaryPassword }),
                CreateUserResult.Invalid invalid => Results.ValidationProblem(invalid.Errors),
                _ => Results.Conflict("That username is already taken")
            };
        });

        // A new random password for someone who forgot theirs. Signs them out everywhere.
        users.MapPost("/{id:int}/reset-password", async (int id, UserAdminService accounts, ICurrentUser admin, CancellationToken ct) =>
        {
            var result = await accounts.ResetPasswordAsync(id, admin.Id!.Value, ct);
            return result switch
            {
                ResetPasswordResult.Reset reset => Results.Ok(
                    new { User = UserService.ToDto(reset.Row), TemporaryPassword = reset.TemporaryPassword }),
                ResetPasswordResult.NotFound => Results.NotFound("There's no such person"),
                _ => Results.Conflict("Use Change password for your own account")
            };
        });

        // Make someone admin or normal, turn the account off or on, or change their username.
        // A rename changes the name from here on: what History already recorded keeps the name it was written with.
        users.MapPut("/{id:int}", async (int id, UserChangeBody body, UserAdminService accounts, ICurrentUser admin,
            CancellationToken ct) =>
        {
            var result = await accounts.UpdateAsync(id, admin.Id!.Value, body.Username, body.Role, body.Disabled, ct);
            return result switch
            {
                UpdateUserResult.Updated updated => Results.Ok(UserService.ToDto(updated.Row)),
                UpdateUserResult.NotFound => Results.NotFound("There's no such person"),
                UpdateUserResult.OwnAccount => Results.Conflict("You can't change your own account here, ask another admin"),
                UpdateUserResult.Invalid invalid => Results.ValidationProblem(invalid.Errors),
                UpdateUserResult.NameTaken => Results.Conflict("That username is already taken"),
                _ => Results.Conflict("There has to be at least one admin")
            };
        });

        // Deletes an account for good. What History already recorded keeps the name, so old entries still read right.
        users.MapDelete("/{id:int}", async (int id, UserAdminService accounts, ICurrentUser admin, CancellationToken ct) =>
        {
            var result = await accounts.DeleteAsync(id, admin.Id!.Value, ct);
            return result switch
            {
                DeleteUserResult.Deleted deleted => Results.Ok(new { Deleted = 1, deleted.Row.Username }),
                DeleteUserResult.NotFound => Results.NotFound("There's no such person"),
                DeleteUserResult.OwnAccount => Results.Conflict("You can't delete your own account"),
                _ => Results.Conflict("There has to be at least one admin, so make someone else an admin first")
            };
        });

        // Notes an admin keeps about an account. They are only ever served from here, and only to an admin.
        users.MapGet("/{id:int}/notes", async (int id, UserAdminService accounts, CancellationToken ct) =>
        {
            var result = await accounts.NotesAsync(id, ct);
            return result switch
            {
                ListNotesResult.Found found => Results.Ok(found.Notes.Select(ToNoteDto)),
                _ => Results.NotFound("There's no such person")
            };
        });

        users.MapPost("/{id:int}/notes", async (int id, NoteBody body, UserAdminService accounts, ICurrentUser admin,
            CancellationToken ct) =>
        {
            var result = await accounts.AddNoteAsync(id, body.Text, admin.Name, ct);
            return result switch
            {
                AddNoteResult.Added added => Results.Created($"/users/{id}/notes/{added.Note.Id}", ToNoteDto(added.Note)),
                AddNoteResult.Invalid invalid => Results.ValidationProblem(invalid.Errors),
                _ => Results.NotFound("There's no such person")
            };
        });

        // For a note that should not have been written. Removing it is the only edit, a note is a record of what was said.
        users.MapDelete("/{id:int}/notes/{noteId:int}", async (int id, int noteId, UserAdminService accounts,
            CancellationToken ct) =>
        {
            var result = await accounts.DeleteNoteAsync(id, noteId, ct);
            return result is DeleteNoteResult.Deleted
                ? Results.NoContent()
                : Results.NotFound("There's no such note");
        });
    }

    // The people list adds whether a note exists to the shared shape, and the one name rule's clash flag
    private static object ToAdminDto(User u, bool hasNotes) => new
    {
        u.Id, u.Username, u.Role, u.Disabled, u.MustChangePassword, u.CreatedAt, u.LastLoginAt, HasNotes = hasNotes, u.NameClash
    };

    private static object ToNoteDto(UserNote n) => new { n.Id, n.Text, n.CreatedBy, n.CreatedAt };
}
