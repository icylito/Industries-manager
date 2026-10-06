using api_v2.Auth;
using api_v2.Data;
using api_v2.Model;
using Microsoft.EntityFrameworkCore;

namespace api_v2.Endpoints;

public record NewUserBody(string? Username, string? Role);
public record UserChangeBody(string? Role, bool? Disabled);

// Accounts, admin only. There is no sign up, so nobody else on the network can make one.
public static class UserEndpoints
{
    public static void MapUsers(this WebApplication app)
    {
        var users = app.MapGroup("/users").RequireDatabaseReady().RequireAdmin();

        users.MapGet("/", async (AppDbContext db, CancellationToken ct) =>
            Results.Ok((await db.Users.AsNoTracking().OrderBy(u => u.Username).ToListAsync(ct)).Select(UserService.ToDto)));

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
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["role"] = ["The role has to be admin or normal"] });
            }
            if (await db.Users.AnyAsync(u => u.Username == username, ct))
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

        // Make someone admin or normal, or turn the account off or on. Never delete, History keeps their name.
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
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["role"] = ["The role has to be admin or normal"] });
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
            await db.SaveChangesAsync(ct);
            if (newDisabled)
            {
                await db.Sessions.Where(s => s.UserId == id).ExecuteDeleteAsync(ct);
            }
            return Results.Ok(UserService.ToDto(user));
        });
    }
}
