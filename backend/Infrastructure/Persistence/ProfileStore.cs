using api_v2.Application.Ports;
using api_v2.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace api_v2.Infrastructure.Persistence;

// The account row and the picture kept for it, through EF
public class ProfileStore(AppDbContext db) : IProfileStore
{
    public Task<User> FindUserAsync(int id, CancellationToken ct) => db.Users.FirstAsync(u => u.Id == id, ct);

    public Task<UserAvatar?> FindAvatarAsync(int userId, CancellationToken ct) =>
        db.UserAvatars.FirstOrDefaultAsync(a => a.UserId == userId, ct);

    public void AddAvatar(UserAvatar avatar) => db.UserAvatars.Add(avatar);

    public Task RemoveAvatarsAsync(int userId, CancellationToken ct) =>
        db.UserAvatars.Where(a => a.UserId == userId).ExecuteDeleteAsync(ct);

    public Task SaveAsync(CancellationToken ct) => db.SaveChangesAsync(ct);
}
