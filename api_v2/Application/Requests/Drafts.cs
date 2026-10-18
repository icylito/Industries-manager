using System.Globalization;
using System.Text.RegularExpressions;

namespace api_v2.Application.Requests;

// The code that comes with a request. It's a starting point, the developer reads it before using it.
public static class Drafts
{
    public static string NewColumn(string label, string type)
    {
        var prop = Pascal(label);
        var key = Regex.Replace(label.ToLowerInvariant(), "[^a-z0-9]+", "_").Trim('_');
        var (cs, ts) = type switch
        {
            "number" => ("decimal?", "number | null"),
            "date" => ("DateOnly?", "string | null"),
            _ => ("string?", "string | null")
        };
        return $"""
            // 1. api_v2/Model/Industry.cs
            public {cs} {prop} {"{ get; set; }"}

            // 2. api_v2/Dtos/CreateIndustry.cs, UpdateIndustry.cs and IndustryDto.cs, add the parameter
            {cs} {prop}

            // 3. api_v2/Endpoints/IndustryEndpoints.cs
            //    pass it into rules.Read(...), set it on the row in the add and the edit, and add it to ToDto and Snapshot

            // 4. api_v2/Rules/FieldRule.cs, add to DefaultRules for new databases
            new("{key}", "{CsString(label)}", "{type}", Required: false),
            //    then for this database add the same field on the Fields page, or with PUT /schema

            // 5. In api_v2, then restart the API so it applies it
            .\migrate.ps1 -Name Add{prop}

            // 6. angular/src/app/models/industry.ts, add to Industry, CreateIndustry and UpdateIndustry
            {key}: {ts};
            """;
    }

    public static string RenamedColumn(string oldColumn, long versionId) => $"""
        // Version #{versionId} has a column "{OneLine(oldColumn)}" that today's table doesn't have.
        // If it was renamed, tell the import where it went, in api_v2/History/TableWriter.cs:

        public static readonly Dictionary<string, string> ColumnRenames = new()
        {"{"}
            ["{CsString(oldColumn)}"] = "NewColumnName",
        {"}"};

        // Restart the API and run the import again, the values land in the new column.
        // If the column was removed on purpose, mark this request as done, the old values stay in the collector.
        """;

    public static string FieldType(string key, string label, string from, string to)
    {
        var cast = to switch
        {
            "number" => $"""CASE WHEN "Extra"->>'{key}' ~ '^-?[0-9]+(\.[0-9]+)?$' THEN to_jsonb(("Extra"->>'{key}')::numeric) ELSE 'null'::jsonb END""",
            "date" => $"""CASE WHEN "Extra"->>'{key}' ~ '^[0-9]{"{4}"}-[0-9]{"{2}"}-[0-9]{"{2}"}' THEN to_jsonb(left("Extra"->>'{key}', 10)) ELSE 'null'::jsonb END""",
            _ => $"""to_jsonb("Extra"->>'{key}')"""
        };
        return $"""
            -- Changes "{OneLine(label)}" from {from} to {to}. Values that don't fit become empty and show as --.
            -- A full copy is in the collector already, check it on the History page before running this.
            UPDATE "Industries"
            SET "Extra" = jsonb_set("Extra", '{"{"}{key}{"}"}', {cast})
            WHERE "Extra" ? '{key}';

            -- Then change the type of "{key}" in the latest rules, either by hand in the RuleVersions table
            -- (copy the newest row's Fields with "type": "{to}" into a new row) or with PUT /schema after
            -- allowing type changes in Rules/RulesService.cs CheckNewRules.
            """;
    }

    public static string RestoreLayout(long versionId, IEnumerable<string> onlyInVersion, IEnumerable<string> onlyNow) => $"""
        // Version #{versionId} was saved with a different table layout. Its data got restored into today's layout,
        // anything in columns that don't exist anymore is still in the collector.
        //
        // Migrations in version #{versionId} that today's database doesn't have:
        //   {string.Join("\n//   ", onlyInVersion.DefaultIfEmpty("(none)"))}
        // Migrations today's database has that version #{versionId} didn't:
        //   {string.Join("\n//   ", onlyNow.DefaultIfEmpty("(none)"))}
        //
        // To really bring the old layout back, the code has to go back too, since the API moves the database
        // forward on every start. Revert the migrations above in git, then in api_v2:
        //   dotnet ef database update <the last migration both have>
        // and restart the API. Check the History page first, a copy is saved before every change.
        """;

    private static string CsString(string text) =>
        text.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n");

    private static string OneLine(string text) => text.Replace("\r", " ").Replace("\n", " ");

    private static string Pascal(string label)
    {
        var words = Regex.Split(label, "[^A-Za-z0-9]+").Where(w => w.Length > 0);
        var name = string.Concat(words.Select(w => char.ToUpper(w[0], CultureInfo.InvariantCulture) + w[1..]));
        return name.Length == 0 || char.IsDigit(name[0]) ? "Field" + name : name;
    }
}
