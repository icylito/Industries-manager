namespace api_v2.Model;

public class Industry
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public string? Sector { get; set;}
    public decimal? Price { get; set; } 
    public DateOnly? Release { get; set; }
    // Set only on imported rows that share a name with row #DuplicateOf, the unique name rule skips them
    public int? DuplicateOf { get; set; }
}