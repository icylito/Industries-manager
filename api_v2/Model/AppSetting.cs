namespace api_v2.Model;

// Settings the team changes from the page, like how long the collector keeps old versions
public class AppSetting
{
    public required string Key { get; set; }
    // The value as JSON
    public required string Value { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public required string UpdatedBy { get; set; }
}
