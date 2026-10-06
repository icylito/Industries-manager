namespace api_v2.Rules;

// One field's rules. Type is "text", "number" or "date".
// Custom fields come from the Fields page and live in the row's Extra JSON, Hidden ones keep their data but leave the page.
public record FieldRule(
    string Key,
    string Label,
    string Type,
    bool Required,
    int? MaxLength = null,
    decimal? Min = null,
    decimal? Max = null,
    bool Custom = false,
    bool Hidden = false
);

// What POST /schema/fields takes to add a custom field
public record NewField(string Label, string Type, bool Required, int? MaxLength, decimal? Min, decimal? Max);

// The rules in use, what GET /schema returns
public record RuleSet(int Version, DateTimeOffset CreatedAt, string ChangedBy, string? Note, IReadOnlyList<FieldRule> Fields);

// What PUT /schema takes. BasedOn is the version the page was looking at.
public record SaveRules(string? Note, List<FieldRule> Fields, int? BasedOn);

public static class DefaultRules
{
    // Version 1, the limits the Dtos had before rules moved to the database
    public static readonly IReadOnlyList<FieldRule> Industries =
    [
        new("name", "Name", "text", Required: true, MaxLength: 50),
        new("sector", "Sector", "text", Required: true, MaxLength: 25),
        new("price", "Price", "number", Required: false, Min: 0, Max: 10),
        new("release", "Release", "date", Required: false),
    ];
}
