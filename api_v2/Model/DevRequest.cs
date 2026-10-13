namespace api_v2.Model;

// Something the team needs a developer for, shown on the Requests page with a bell count
public class DevRequest
{
    public int Id { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    // column, rename, field-type, restore-layout or other
    public required string Kind { get; set; }
    public required string Title { get; set; }
    public required string Details { get; set; }
    // Code drafted for the developer, they still review it before using it
    public string? DraftedCode { get; set; }
    // open, in-progress, done or dismissed
    public required string Status { get; set; }
    public required string CreatedBy { get; set; }
    // The field this is about, its column header shows a "waiting for a developer" marker while open
    public string? FieldKey { get; set; }
    public DateTimeOffset? ResolvedAt { get; set; }
    public string? ResolvedBy { get; set; }
}
