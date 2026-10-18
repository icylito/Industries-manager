using api_v2.Application.Auth;
using api_v2.Infrastructure.Security;
using api_v2.Application.Health;
using api_v2.Infrastructure.Persistence;
using api_v2.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using api_v2.Presentation.Contracts;

using api_v2.Presentation.Authorization;
using api_v2.Application.Ports;
using api_v2.Domain.Accounts;

namespace api_v2.Presentation.Endpoints;

// Accounts, admin only. There is no sign up, so nobody else on the network can make one.
public static class UserEndpoints
{
    public static void MapUsers(this WebApplication app)
    {
        var users = app.MapGroup("/users").RequireDatabaseReady().RequireAdmin();

        // The people list also says who has a note, so an admin can see one exists without opening anything.
        // Notes are not part of UserService.ToDto on purpose: that shape is what /auth/me hands a person about themselves.
        users.MapGet("/", async (AppDbContext db, CancellationToken ct) =>
        {
            var noted = (await db.UserNotes.AsNoTracking().Select(n => n.UserId).Distinct().ToListAsync(ct)).ToHashSet();
            var people = await db.Users.AsNoTracking().OrderBy(u => u.Username).ToListAsync(ct);
            return Results.Ok(people.Select(u => ToAdminDto(u, noted.Contains(u.Id))));
        });

        // Makes the account with a random password that's shown once. The person has to pick their own at first sign in.
        users.MapPost("/", async (NewUserBody body, AppDbContext db, ICurrentUser admin, CancellationToken ct) =>
        {
            var problem = UserService.CheckUsername(body.Username, out var username);
            if (problem is not null)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["username"] = [problem] });
            }
            var role = body.Role ?? Roles.Normal;
            if (!Roles.IsValid(role))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["role"] = [Roles.InvalidMessage] });
            }
            if (await UserService.UsernameTakenAsync(db, username, null, ct))
            {
                return Results.Conflict("That username is already taken");
            }

            var password = PasswordHasher.Generate();
            var user = new User
            {
                Username = username,
                PasswordHash = PasswordHasher.Hash(password),
                Role = role,
                MustChangePassword = true,
                CreatedAt = DateTimeOffset.UtcNow,
                CreatedBy = admin.Name
            };
            db.Users.Add(user);
            try
            {
                await db.SaveChangesAsync(ct);
            }
            catch (DbUpdateException)
            {
                db.ChangeTracker.Clear();
                return Results.Conflict("That username is already taken");
            }
            return Results.Created($"/users/{user.Id}", new { User = UserService.ToDto(user), TemporaryPassword = password });
        });

        // A new random password for someone who forgot theirs. Signs them out everywhere.
        users.MapPost("/{id:int}/reset-password", async (int id, AppDbContext db, ICurrentUser admin, CancellationToken ct) =>
        {
            var user = await db.Users.FirstOrDefaultAsync(u => u.Id == id, ct);
            if (user is null) return Results.NotFound("There's no such person");
            if (user.Id == admin.Id)
            {
                return Results.Conflict("Use Change password for your own account");
            }

            var password = PasswordHasher.Generate();
            user.PasswordHash = PasswordHasher.Hash(password);
            user.MustChangePassword = true;
            user.PasswordChangedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(ct);
            await db.Sessions.Where(s => s.UserId == id).ExecuteDeleteAsync(ct);
            return Results.Ok(new { User = UserService.ToDto(user), TemporaryPassword = password });
        });

        // Make someone admin or normal, turn the account off or on, or change their username.
        // A rename changes the name from here on: what History already recorded keeps the name it was written with.
        users.MapPut("/{id:int}", async (int id, UserChangeBody body, AppDbContext db, ICurrentUser admin, CancellationToken ct) =>
        {
            var user = await db.Users.FirstOrDefaultAsync(u => u.Id == id, ct);
            if (user is null) return Results.NotFound("There's no such person");
            if (user.Id == admin.Id)
            {
                return Results.Conflict("You can't change your own account here, ask another admin");
            }
            if (body.Role is not null && !Roles.IsValid(body.Role))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["role"] = [Roles.InvalidMessage] });
            }

            string? renamed = null;
            if (body.Username is not null)
            {
                var problem = UserService.CheckUsername(body.Username, out var clean);
                if (problem is not null)
                {
                    return Results.ValidationProblem(new Dictionary<string, string[]> { ["username"] = [problem] });
                }
                if (!string.Equals(clean, user.Username, StringComparison.Ordinal))
                {
                    if (await UserService.UsernameTakenAsync(db, clean, id, ct))
                    {
                        return Results.Conflict("That username is already taken");
                    }
                    renamed = clean;
                    // The new name was checked against everyone, so this account clashes with no one now
                    user.NameClash = false;
                }
            }

            var newRole = body.Role ?? user.Role;
            var newDisabled = body.Disabled ?? user.Disabled;
            var losesAdmin = user.Role == Roles.Admin && !user.Disabled && (newRole != Roles.Admin || newDisabled);
            if (losesAdmin && !await db.Users.AnyAsync(u => u.Id != id && u.Role == Roles.Admin && !u.Disabled, ct))
            {
                return Results.Conflict("There has to be at least one admin");
            }

            user.Role = newRole;
            user.Disabled = newDisabled;
            if (renamed is not null) user.Username = renamed;
            try
            {
                await db.SaveChangesAsync(ct);
            }
            catch (DbUpdateException)
            {
                // The unique index catches two people taking the same name at the same moment
                db.ChangeTracker.Clear();
                return Results.Conflict("That username is already taken");
            }
            if (newDisabled)
            {
                await db.Sessions.Where(s => s.UserId == id).ExecuteDeleteAsync(ct);
            }
            // A new name can free an account that clashed with the old one
            if (renamed is not null) await UserService.RefreshNameClashesAsync(db, ct);
            return Results.Ok(UserService.ToDto(user));
        });

        // Deletes an account for good. What History already recorded keeps the name, so old entries still read right.
        users.MapDelete("/{id:int}", async (int id, AppDbContext db, ICurrentUser admin, CancellationToken ct) =>
        {
            var user = await db.Users.FirstOrDefaultAsync(u => u.Id == id, ct);
            if (user is null) return Results.NotFound("There's no such person");
            if (user.Id == admin.Id)
            {
                return Results.Conflict("You can't delete your own account");
            }
            // With no admin left the API makes a fresh one on the next start, so this is refused instead
            if (user.Role == Roles.Admin && !user.Disabled
                && !await db.Users.AnyAsync(u => u.Id != id && u.Role == Roles.Admin && !u.Disabled, ct))
            {
                return Results.Conflict("There has to be at least one admin, so make someone else an admin first");
            }

            db.Users.Remove(user);
            await db.SaveChangesAsync(ct);
            // An account that clashed with this one doesn't any more
            await UserService.RefreshNameClashesAsync(db, ct);
            return Results.Ok(new { Deleted = 1, user.Username });
        });

        // Notes an admin keeps about an account. They are only ever served from here, and only to an admin.
        users.MapGet("/{id:int}/notes", async (int id, AppDbContext db, CancellationToken ct) =>
        {
            if (!await db.Users.AnyAsync(u => u.Id == id, ct)) return Results.NotFound("There's no such person");
            var notes = await db.UserNotes.AsNoTracking().Where(n => n.UserId == id).OrderBy(n => n.Id).ToListAsync(ct);
            return Results.Ok(notes.Select(ToNoteDto));
        });

        users.MapPost("/{id:int}/notes", async (int id, NoteBody body, AppDbContext db, ICurrentUser admin, CancellationToken ct) =>
        {
            if (!await db.Users.AnyAsync(u => u.Id == id, ct)) return Results.NotFound("There's no such person");
            var text = (body.Text ?? string.Empty).Trim();
            if (text.Length == 0)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["text"] = ["Type the note first"] });
            }
            if (text.Length > 2000)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["text"] = ["A note can be at most 2000 characters"] });
            }

            var note = new UserNote { UserId = id, Text = text, CreatedBy = admin.Name, CreatedAt = DateTimeOffset.UtcNow };
            db.UserNotes.Add(note);
            await db.SaveChangesAsync(ct);
            return Results.Created($"/users/{id}/notes/{note.Id}", ToNoteDto(note));
        });

        // For a note that should not have been written. Removing it is the only edit, a note is a record of what was said.
        users.MapDelete("/{id:int}/notes/{noteId:int}", async (int id, int noteId, AppDbContext db, CancellationToken ct) =>
        {
            var removed = await db.UserNotes.Where(n => n.Id == noteId && n.UserId == id).ExecuteDeleteAsync(ct);
            return removed == 0 ? Results.NotFound("There's no such note") : Results.NoContent();
        });
    }

    // The people list adds whether a note exists to the shared shape, and the one name rule's clash flag
    private static object ToAdminDto(User u, bool hasNotes) => new
    {
        u.Id, u.Username, u.Role, u.Disabled, u.MustChangePassword, u.CreatedAt, u.LastLoginAt, HasNotes = hasNotes, u.NameClash
    };

    private static object ToNoteDto(UserNote n) => new { n.Id, n.Text, n.CreatedBy, n.CreatedAt };
}
