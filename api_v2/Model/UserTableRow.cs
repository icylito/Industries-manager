namespace api_v2.Model;

// One row of a table from the Tables page. Data is a JSON object keyed by the table's column keys.
// Deleting the table for good takes its rows with it.
public class UserTableRow
{
    public int Id { get; set; }
    public int TableId { get; set; }
    public required string Data { get; set; }
    public required string CreatedBy { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
