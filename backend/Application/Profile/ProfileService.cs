using api_v2.Application.Auth;
using api_v2.Application.Ports;
using api_v2.Domain.Accounts;
using api_v2.Domain.Entities;

namespace api_v2.Application.Profile;

public abstract record ProfileResult
{
    public sealed record Updated(UserDto User) : ProfileResult;
    public sealed record Invalid(IReadOnlyDictionary<string, string[]> Errors) : ProfileResult;
}

// The signed in person's profile card: the name they show and their picture. Only ever their own.
public class ProfileService(IProfileStore store)
{
    // Empty puts the username back.
    public async Task<ProfileResult> UpdateNameAsync(int userId, string? displayName, CancellationToken ct)
    {
        var (name, errors) = ProfileRules.CheckName(displayName);
        if (errors.Count > 0)
        {
            return new ProfileResult.Invalid(errors);
        }
        var me = await store.FindUserAsync(userId, ct);
        me.DisplayName = string.IsNullOrEmpty(name) ? null : name;
        await store.SaveAsync(ct);
        return new ProfileResult.Updated(UserService.ToDto(me));
    }

    public Task<UserAvatar?> AvatarAsync(int userId, CancellationToken ct) => store.FindAvatarAsync(userId, ct);

    public async Task<ProfileResult> SaveAvatarAsync(int userId, string? contentType, byte[] bytes, CancellationToken ct)
    {
        var problem = ProfileRules.CheckPicture(contentType, bytes);
        if (problem is not null)
        {
            return new ProfileResult.Invalid(new Dictionary<string, string[]> { ["picture"] = [problem] });
        }

        var now = DateTimeOffset.UtcNow;
        var picture = await store.FindAvatarAsync(userId, ct);
        if (picture is null)
        {
            store.AddAvatar(new UserAvatar { UserId = userId, ContentType = contentType!, Bytes = bytes, UpdatedAt = now });
        }
        else
        {
            picture.ContentType = contentType!;
            picture.Bytes = bytes;
            picture.UpdatedAt = now;
        }
        var me = await store.FindUserAsync(userId, ct);
        me.AvatarAt = now;
        await store.SaveAsync(ct);
        return new ProfileResult.Updated(UserService.ToDto(me));
    }

    public async Task<ProfileResult> DeleteAvatarAsync(int userId, CancellationToken ct)
    {
        await store.RemoveAvatarsAsync(userId, ct);
        var me = await store.FindUserAsync(userId, ct);
        me.AvatarAt = null;
        await store.SaveAsync(ct);
        return new ProfileResult.Updated(UserService.ToDto(me));
    }
}
