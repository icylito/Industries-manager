using api_v2.Domain.Entities;

namespace api_v2.Application.Ports;

// A person's profile card: the display name on the account row and the picture kept next to it
public interface IProfileStore
{
    // Tracked, because the name and the picture time are written back to the account row
    Task<User> FindUserAsync(int id, CancellationToken ct);

    Task<UserAvatar?> FindAvatarAsync(int userId, CancellationToken ct);

    void AddAvatar(UserAvatar avatar);

    Task RemoveAvatarsAsync(int userId, CancellationToken ct);

    Task SaveAsync(CancellationToken ct);
}
