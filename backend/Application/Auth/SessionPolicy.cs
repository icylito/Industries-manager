using System.Security.Cryptography;
using System.Text;

namespace api_v2.Application.Auth;

// How long a sign in lasts and how its token is hashed. Shared by the loader that reads tokens and the
// use case that makes them, so the two can't disagree.
public static class SessionPolicy
{
    // A session lasts 12 hours after its last use, and 7 days at most
    public static readonly TimeSpan IdleLimit = TimeSpan.FromHours(12);
    public static readonly TimeSpan AgeLimit = TimeSpan.FromDays(7);

    public static byte[] HashToken(string token) => SHA256.HashData(Encoding.UTF8.GetBytes(token));
}
