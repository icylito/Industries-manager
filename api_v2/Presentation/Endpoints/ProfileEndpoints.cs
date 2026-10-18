using api_v2.Application.Auth;
using api_v2.Infrastructure.Security;
using api_v2.Application.Health;
using api_v2.Application.Hosted;
using api_v2.Application.Settings;
using api_v2.Application.Startup;
using api_v2.Infrastructure.Configuration;
using api_v2.Infrastructure.Export;
using api_v2.Infrastructure.Files;
using api_v2.Infrastructure.Persistence;
using api_v2.Domain.Entities;
using api_v2.Domain.Rules;
using api_v2.Presentation.Contracts;
using Microsoft.EntityFrameworkCore;

namespace api_v2.Presentation.Endpoints;

// The signed in person's profile card: the name they show and their picture. Only ever their own.
// The page crops and shrinks a picture to a small square before it sends it, so the API only keeps what fits that.
public static class ProfileEndpoints
{
    public const int MaxName = 60;
    public const int MaxPictureBytes = 300 * 1024;

    // The kinds of picture kept, each with the bytes its file starts with, so a name or a header can't lie about it.
    // A WebP is a RIFF file: "RIFF" first, then its size, then "WEBP".
    private static readonly (string Type, (byte[] Bytes, int At)[] Marks)[] Pictures =
    [
        ("image/png", [([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], 0)]),
        ("image/jpeg", [([0xFF, 0xD8, 0xFF], 0)]),
        ("image/webp", [("RIFF"u8.ToArray(), 0), ("WEBP"u8.ToArray(), 8)]),
    ];

    private static string? TypeOf(byte[] bytes) =>
        Pictures.FirstOrDefault(p => p.Marks.All(m => bytes.Length >= m.At + m.Bytes.Length && bytes.AsSpan(m.At, m.Bytes.Length).SequenceEqual(m.Bytes))).Type;

    public static void MapProfile(this RouteGroupBuilder me)
    {
        // The name on the card. Empty puts the username back.
        me.MapPut("/profile", async (MyProfile body, AppDbContext db, ICurrentUser user, CancellationToken ct) =>
        {
            var name = Names.Clean(body.DisplayName);
            if (name is { Length: > MaxName })
            {
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["displayName"] = [$"A name is at most {MaxName} characters"] });
            }
            var me = await db.Users.FirstAsync(u => u.Id == user.Id, ct);
            me.DisplayName = string.IsNullOrEmpty(name) ? null : name;
            await db.SaveChangesAsync(ct);
            return Results.Ok(UserService.ToDto(me));
        });

        me.MapGet("/avatar", async (AppDbContext db, ICurrentUser user, HttpResponse response, CancellationToken ct) =>
        {
            var picture = await db.UserAvatars.AsNoTracking().FirstOrDefaultAsync(a => a.UserId == user.Id, ct);
            if (picture is null) return Results.NotFound();
            response.Headers.CacheControl = "private, no-cache";
            // The browser takes the type it is given, never guesses another from the bytes
            response.Headers.XContentTypeOptions = "nosniff";
            return Results.File(picture.Bytes, picture.ContentType);
        });

        // The picture as the body, with its type as Content-Type
        me.MapPut("/avatar", async (HttpRequest request, AppDbContext db, ICurrentUser user, CancellationToken ct) =>
        {
            if (request.ContentLength is > MaxPictureBytes) return TooBig();
            // Read no more than the limit and one byte, so a body sent without a length can't fill the memory
            var buffer = new byte[MaxPictureBytes + 1];
            var read = 0;
            while (read < buffer.Length)
            {
                var got = await request.Body.ReadAsync(buffer.AsMemory(read), ct);
                if (got == 0) break;
                read += got;
            }
            if (read > MaxPictureBytes) return TooBig();
            var bytes = buffer[..read];
            var type = TypeOf(bytes);
            if (type is null || !string.Equals(type, request.ContentType, StringComparison.OrdinalIgnoreCase))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["picture"] = ["A picture is a PNG, JPEG or WebP image"] });
            }

            var now = DateTimeOffset.UtcNow;
            var picture = await db.UserAvatars.FirstOrDefaultAsync(a => a.UserId == user.Id, ct);
            if (picture is null) db.UserAvatars.Add(new UserAvatar { UserId = user.Id!.Value, ContentType = type, Bytes = bytes, UpdatedAt = now });
            else
            {
                picture.ContentType = type;
                picture.Bytes = bytes;
                picture.UpdatedAt = now;
            }
            var me = await db.Users.FirstAsync(u => u.Id == user.Id, ct);
            me.AvatarAt = now;
            await db.SaveChangesAsync(ct);
            return Results.Ok(UserService.ToDto(me));
        });

        me.MapDelete("/avatar", async (AppDbContext db, ICurrentUser user, CancellationToken ct) =>
        {
            await db.UserAvatars.Where(a => a.UserId == user.Id).ExecuteDeleteAsync(ct);
            var me = await db.Users.FirstAsync(u => u.Id == user.Id, ct);
            me.AvatarAt = null;
            await db.SaveChangesAsync(ct);
            return Results.Ok(UserService.ToDto(me));
        });
    }

    private static IResult TooBig() =>
        Results.ValidationProblem(new Dictionary<string, string[]> { ["picture"] = [$"A picture is at most {MaxPictureBytes / 1024} KB once shrunk"] });
}
