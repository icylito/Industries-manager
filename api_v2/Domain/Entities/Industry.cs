namespace api_v2.Domain.Entities;

public class Industry
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public string? Sector { get; set;}
    public decimal? Price { get; set; } 
    public DateOnly? Release { get; set; }
    // Set only on imported rows that share a name with row #DuplicateOf, the unique name rule skips them
    public int? DuplicateOf { get; set; }
    // The collector version this row was imported from, null for rows made on the page
    public int? ImportedFrom { get; set; }
    // Fields that couldn't be brought over from old data, shown as -- with a red triangle until the row is saved again
    public List<string>? LostFields { get; set; }
    // Values of the custom fields from the Fields page, as JSON
    public string? Extra { get; set; }
}
