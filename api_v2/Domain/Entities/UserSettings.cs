namespace api_v2.Domain.Entities;

// The choices one person made for themselves, kept on the server so they follow them to any browser:
// their keyboard shortcuts, the held keys of the Scratchpad's mouse rows, and light or dark.
public class UserSettings
{
    // The person, and the key. Deleting the account takes their settings.
    public int UserId { get; set; }
    // Only the keys changed from the defaults: { "sp.select": ["X"], ... }. An empty list means no key.
    public required string Shortcuts { get; set; }
    // Only the mouse rows changed from the defaults: { "mouse.add": "Alt", ... }
    public required string Mouse { get; set; }
    // "light", "dark", or null to follow the computer's own setting
    public string? Theme { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
