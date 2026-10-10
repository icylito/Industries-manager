namespace api_v2.Model;

// One Scratchpad board: everything a person put on one endless canvas, kept as one JSON document so new kinds of
// thing (drawings, boxes) need no migration. A person can keep several, each with a name, listed on the
// Scratchpad's History tab. The document's shape is checked in Scratchpad/BoardRules.cs.
public class ScratchBoard
{
    public int Id { get; set; }
    // The person the board belongs to. Deleting the account takes their boards with them.
    public int UserId { get; set; }
    // What the History tab calls it. Names may repeat, like file names in two folders.
    public required string Name { get; set; }
    // A pinned board stays at the top of the History tab and can't be deleted until it is unpinned
    public bool Pinned { get; set; }
    // { version, items: [...], lines: [...], groups: [...] }
    public required string Document { get; set; }
    // Where the person left it: { x, y, zoom }. Kept apart from the document, so moving around never touches
    // the board's undo history and never makes a save of the board refuse with "changed somewhere else"
    public string? View { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    // When the document last changed. Renaming, pinning and moving the view leave it alone.
    public DateTimeOffset UpdatedAt { get; set; }
}
