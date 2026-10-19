namespace api_v2.Domain.Entities;

// A person's profile picture: a small square the page has already cropped and shrunk, so it fits in a row.
// One per person, gone with the account. Always current, like the account itself (Data/StateModel.cs).
public class UserAvatar
{
    public int UserId { get; set; }
    // image/webp, image/jpeg or image/png, checked against the bytes when it is saved
    public required string ContentType { get; set; }
    public required byte[] Bytes { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
