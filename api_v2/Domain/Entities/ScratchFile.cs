namespace api_v2.Domain.Entities;

// One file a person put on their Scratchpad. The bytes live on disk; the row says who owns them and what the
// card shows. Name is the original name, only ever shown to the person. StoredName is the only name on disk.
public class ScratchFile
{
    public int Id { get; set; }
    // The person the file belongs to. Deleting the account takes the file with them.
    public int UserId { get; set; }
    // The original name, shown on the card. Never used as a path.
    public required string Name { get; set; }
    // What the browser said the file is, capped, used only to choose inline or attachment.
    public required string ContentType { get; set; }
    public long SizeBytes { get; set; }
    // A GUID plus extension, the only name on disk. Unique, so two uploads can never collide.
    public required string StoredName { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    // When the sweep first found no board of the person's using this file. Cleared if a board uses it again.
    // Seven days after this the file is deleted for good, see Scratchpad/ScratchFileSweeper.cs.
    public DateTimeOffset? OrphanedAt { get; set; }
}
