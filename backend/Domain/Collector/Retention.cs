namespace api_v2.Domain.Collector;

// How long the collector keeps old versions. Null means keep them all, pinned versions are always kept.
public record Retention(int? KeepVersions, int? KeepDays);

// The limits a retention setting has to fit in. Pure: no database, no files.
public static class RetentionRules
{
    public static Dictionary<string, string[]> Check(Retention r)
    {
        var errors = new Dictionary<string, string[]>();
        if (r.KeepVersions is < 1 or > 10000) errors["keepVersions"] = ["Keep at least 1 version, or leave it empty to keep all"];
        if (r.KeepDays is < 1 or > 36500) errors["keepDays"] = ["Use 1 day or more, or leave it empty to never delete by age"];
        return errors;
    }
}
