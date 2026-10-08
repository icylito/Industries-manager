namespace api_v2.Model;

// One person's Scratchpad: everything they put on the endless canvas, kept as one JSON document so a
// later slice can add lines, groups, snapshots and files without another migration.
// The document's shape is checked in Endpoints/ScratchpadEndpoints.cs.
public class ScratchBoard
{
    public int Id { get; set; }
    // The person the board belongs to. One board each, and deleting the account takes it with them.
    public int UserId { get; set; }
    // { version, view: { x, y, zoom }, items: [...] }
    public required string Document { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
