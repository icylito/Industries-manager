namespace api_v2.Model;

// A table a manager or admin made from the Tables page. It is data, not a real Postgres table: its columns
// are a JSON list and its rows live in UserTableRows, so making or deleting one never changes the database
// layout, and backups and restores carry it like any other row. See Endpoints/UserTableEndpoints.cs.
public class UserTable
{
    public int Id { get; set; }
    // Unique among live tables by the one name rule (Rules/Names.cs, an index on Name with the collation name_rule)
    public required string Name { get; set; }
    // The columns as a JSON list of FieldRule ({ key, label, type, required, maxLength, min, max, hidden, options }).
    // Keys are made by the API from the label, never typed by a person.
    public required string Columns { get; set; }
    // Kept up to date with every row change, so the row limit is cheap to check
    public int RowCount { get; set; }
    public required string CreatedBy { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    // Set when the table goes to the bin. It is emptied for good 14 days later.
    public DateTimeOffset? DeletedAt { get; set; }
    // Goes up with every change to the table itself, so two people editing columns can't overwrite each other
    public int Version { get; set; } = 1;
}
