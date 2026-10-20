namespace api_v2.Domain.Entities;

// One file a person put on their Scratchpad. The row says who owns it and what the card shows, the bytes sit in
// ScratchFileContent beside it, so the database holds the whole file. Name is the original name, only ever shown
// to the person.
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
    // A GUID plus extension, unique. Files used to live on disk under this name, and the one-time import in
    // Infrastructure/Files/ScratchFileImport.cs finds them by it.
    public required string StoredName { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    // When the sweep first found no board of the person's using this file. Cleared if a board uses it again.
    // Seven days after this the file is deleted for good, see Application/Jobs/ScratchFileSweep.cs.
    public DateTimeOffset? OrphanedAt { get; set; }
    // The bytes. Only set when an upload adds the row; reads of the row leave it unloaded, the download asks for it alone.
    public ScratchFileContent? Content { get; set; }
}
