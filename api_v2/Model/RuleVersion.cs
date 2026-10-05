namespace api_v2.Model;

// Every rules change adds a row here, the newest one is the rules in use
public class RuleVersion
{
    public int Id { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public required string ChangedBy { get; set; }
    public string? Note { get; set; }
    // The field rules as JSON, see Rules/FieldRule.cs
    public required string Fields { get; set; }
}
