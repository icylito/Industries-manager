namespace api_v2.Domain.Entities;

// The carry tray: snapshots from the Overview on their way to a board. One per person, shown along the bottom
// of every admin page, so it belongs to the person rather than to any one board.
public class ScratchTray
{
    // The person it belongs to, and the key. Deleting the account takes it.
    public int UserId { get; set; }
    // [ { id, kind, title, takenAt, numbers, split, pick }, ... ], at most 20, oldest first
    public required string Items { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
