namespace api_v2.Domain.Rules;

// One field's rules. Type is "text", "number" or "date".
// Custom fields come from the Fields page and live in the row's Extra JSON, Hidden ones keep their data but leave the page.
// Options is the allowed list for a text field. Only config.toml fills it in, and only Sector uses it today.
public record FieldRule(
    string Key,
    string Label,
    string Type,
    bool Required,
    int? MaxLength = null,
    decimal? Min = null,
    decimal? Max = null,
    bool Custom = false,
    bool Hidden = false,
    List<string>? Options = null)
{
    // A list compares by reference, which would make every rules check look changed. Compare the words instead.
    // No list and an empty list are the same.
    public virtual bool Equals(FieldRule? other)
    {
        if (other is null) return false;
        if (ReferenceEquals(this, other)) return true;
        return Key == other.Key
            && Label == other.Label
            && Type == other.Type
            && Required == other.Required
            && MaxLength == other.MaxLength
            && Min == other.Min
            && Max == other.Max
            && Custom == other.Custom
            && Hidden == other.Hidden
            && SameOptions(Options, other.Options);
    }

    public override int GetHashCode()
    {
        var hash = new HashCode();
        hash.Add(Key);
        hash.Add(Label);
        hash.Add(Type);
        hash.Add(Required);
        hash.Add(MaxLength);
        hash.Add(Min);
        hash.Add(Max);
        hash.Add(Custom);
        hash.Add(Hidden);
        if (Options is { Count: > 0 })
        {
            foreach (var option in Options) hash.Add(option);
        }
        return hash.ToHashCode();
    }

    public static bool SameOptions(IReadOnlyList<string>? left, IReadOnlyList<string>? right)
    {
        var leftEmpty = left is null || left.Count == 0;
        var rightEmpty = right is null || right.Count == 0;
        if (leftEmpty && rightEmpty) return true;
        if (leftEmpty || rightEmpty) return false;
        return left!.SequenceEqual(right!);
    }
}

// What POST /schema/fields takes to add a custom field
public record NewField(string Label, string Type, bool Required, int? MaxLength, decimal? Min, decimal? Max);

// What POST /schema/fields/many takes. BasedOn is the rules version the page was looking at.
public record NewFields(int? BasedOn, List<NewField>? Fields);

// What DELETE /schema/fields/{key} gives back: the rules now, how many rows lost a value, how many open requests were closed
public record FieldDeleted(RuleSet Rules, int RowsChanged, int RequestsClosed);

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
