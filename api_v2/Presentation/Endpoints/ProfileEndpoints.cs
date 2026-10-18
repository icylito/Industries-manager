using api_v2.Application.Auth;
using api_v2.Application.Profile;
using api_v2.Domain.Accounts;
using api_v2.Presentation.Contracts;
using api_v2.Application.Ports;

namespace api_v2.Presentation.Endpoints;

// The signed in person's profile card: the name they show and their picture. Only ever their own.
public static class ProfileEndpoints
{
    public const int MaxName = ProfileRules.MaxName;
    public const int MaxPictureBytes = ProfileRules.MaxPictureBytes;

    public static void MapProfile(this RouteGroupBuilder me)
    {
        // The name on the card. Empty puts the username back.
        me.MapPut("/profile", async (MyProfile body, ProfileService profile, ICurrentUser user, CancellationToken ct) =>
        {
            var result = await profile.UpdateNameAsync(user.Id!.Value, body.DisplayName, ct);
            return result switch
            {
                ProfileResult.Updated updated => Results.Ok(updated.User),
                ProfileResult.Invalid invalid => Results.ValidationProblem(invalid.Errors),
                _ => Results.Problem()
            };
        });

        me.MapGet("/avatar", async (ProfileService profile, ICurrentUser user, HttpResponse response, CancellationToken ct) =>
        {
            var picture = await profile.AvatarAsync(user.Id!.Value, ct);
            if (picture is null) return Results.NotFound();
            response.Headers.CacheControl = "private, no-cache";
            // The browser takes the type it is given, never guesses another from the bytes
            response.Headers.XContentTypeOptions = "nosniff";
            return Results.File(picture.Bytes, picture.ContentType);
        });

        // The picture as the body, with its type as Content-Type
        me.MapPut("/avatar", async (HttpRequest request, ProfileService profile, ICurrentUser user, CancellationToken ct) =>
        {
            if (request.ContentLength is > ProfileRules.MaxPictureBytes) return TooBig();
            // Read no more than the limit and one byte, so a body sent without a length can't fill the memory
            var buffer = new byte[ProfileRules.MaxPictureBytes + 1];
            var read = 0;
            while (read < buffer.Length)
            {
                var got = await request.Body.ReadAsync(buffer.AsMemory(read), ct);
                if (got == 0) break;
                read += got;
            }
            if (read > ProfileRules.MaxPictureBytes) return TooBig();

            var result = await profile.SaveAvatarAsync(user.Id!.Value, request.ContentType, buffer[..read], ct);
            return result switch
            {
                ProfileResult.Updated updated => Results.Ok(updated.User),
                ProfileResult.Invalid invalid => Results.ValidationProblem(invalid.Errors),
                _ => Results.Problem()
            };
        });

        me.MapDelete("/avatar", async (ProfileService profile, ICurrentUser user, CancellationToken ct) =>
        {
            var result = await profile.DeleteAvatarAsync(user.Id!.Value, ct);
            return result switch
            {
                ProfileResult.Updated updated => Results.Ok(updated.User),
                ProfileResult.Invalid invalid => Results.ValidationProblem(invalid.Errors),
                _ => Results.Problem()
            };
        });
    }

    private static IResult TooBig() =>
        Results.ValidationProblem(new Dictionary<string, string[]> { ["picture"] = [ProfileRules.TooBigMessage] });
}
