namespace api_v2.Domain.Accounts;

// What an account is allowed to do. Changes to the table, the rules, history and settings need an admin;
// making and changing tables on the Tables page and restoring backups needs a manager.
public static class Roles
{
    public const string Admin = "admin";
    // Makes and changes tables on the Tables page and restores backups, nothing else an admin does
    public const string Manager = "manager";
    public const string Normal = "normal";

    public static bool IsValid(string? role) => role is Admin or Manager or Normal;

    // The plain message when a role isn't one of these
    public const string InvalidMessage = "The role has to be admin, manager or normal";
}
