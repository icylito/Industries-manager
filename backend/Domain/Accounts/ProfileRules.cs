using api_v2.Domain.Rules;

namespace api_v2.Domain.Accounts;

// The display name and the picture on a person's profile card. The page crops and shrinks a picture to a small
// square before it sends it, so the API only keeps what fits that.
public static class ProfileRules
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

    // The type the bytes really are, or null when they are none of the three
    public static string? TypeOf(byte[] bytes) =>
        Pictures.FirstOrDefault(p => p.Marks.All(m => bytes.Length >= m.At + m.Bytes.Length && bytes.AsSpan(m.At, m.Bytes.Length).SequenceEqual(m.Bytes))).Type;

    // The cleaned display name, or the problems the page shows under the field
    public static (string? Name, Dictionary<string, string[]> Errors) CheckName(string? raw)
    {
        var name = Names.Clean(raw);
        if (name is { Length: > MaxName })
        {
            return (null, new Dictionary<string, string[]> { ["displayName"] = [$"A name is at most {MaxName} characters"] });
        }
        return (name, []);
    }

    // Null when the body really is the picture type it claims to be, otherwise the message the page shows
    public static string? CheckPicture(string? contentType, byte[] bytes)
    {
        var type = TypeOf(bytes);
        if (type is null || !string.Equals(type, contentType, StringComparison.OrdinalIgnoreCase))
        {
            return "A picture is a PNG, JPEG or WebP image";
        }
        return null;
    }

    public static string TooBigMessage => $"A picture is at most {MaxPictureBytes / 1024} KB once shrunk";
}
