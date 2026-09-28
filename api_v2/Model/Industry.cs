namespace api_v2.Model;

public class Industry
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public string? Sector { get; set;}
    public decimal? Price { get; set; } 
    public DateOnly Release { get; set; }
}