using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using api_v2.Data;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;

namespace api_v2.Rules;

// Names are cleaned before they are saved. Comparisons use Postgres lower(), never C# ToLower.
public static class Names
{
    // 200 characters is at most 800 bytes, under the 2704 byte limit of the name index
    public const int MaxLength = 200;

    public static string? Clean(string? name)
    {
        if (name is null) return null;
        var normalized = name.Normalize(NormalizationForm.FormKC);
        var builder = new StringBuilder(normalized.Length);
        foreach (var ch in normalized)
        {
            // Tab and newline are control characters and whitespace. Keep them as a space.
            if (char.IsWhiteSpace(ch))
            {
                builder.Append(' ');
                continue;
            }
            var category = CharUnicodeInfo.GetUnicodeCategory(ch);
            if (category is UnicodeCategory.Format or UnicodeCategory.Control) continue;
            builder.Append(ch);
        }
        return Regex.Replace(builder.ToString(), @"\s+", " ").Trim();
    }

    public static bool HasHiddenCharacters(string text)
    {
        foreach (var ch in text)
        {
            var category = CharUnicodeInfo.GetUnicodeCategory(ch);
            if (category is UnicodeCategory.Format or UnicodeCategory.Control) return true;
        }
        return false;
    }

    // Rows flagged as copies (DuplicateOf set) don't count, same as the unique index
    public static async Task<bool> TakenAsync(AppDbContext db, string name, int? exceptId, CancellationToken ct = default)
    {
        var count = await db.Database.SqlQuery<int>($"""
            SELECT count(*)::int AS "Value" FROM "Industries"
            WHERE "DuplicateOf" IS NULL AND lower(btrim("Name")) = lower(btrim({name})) AND "Id" <> {exceptId ?? 0}
            """).SingleAsync(ct);
        return count > 0;
    }

    public static async Task<bool> SameAsync(AppDbContext db, string a, string b, CancellationToken ct = default)
    {
        return await db.Database.SqlQuery<bool>($"""
            SELECT lower(btrim({a})) = lower(btrim({b})) AS "Value"
            """).SingleAsync(ct);
    }

    public static async Task<Dictionary<string, string>> KeysAsync(NpgsqlConnection conn, NpgsqlTransaction? tx,
        IEnumerable<string> names, CancellationToken ct = default)
    {
        var list = names.Distinct().ToArray();
        var map = new Dictionary<string, string>();
        if (list.Length == 0) return map;
        await using var cmd = new NpgsqlCommand("""SELECT n, lower(btrim(n)) FROM unnest(@names) AS n""", conn, tx);
        cmd.Parameters.Add(new NpgsqlParameter("names", NpgsqlDbType.Array | NpgsqlDbType.Text) { Value = list });
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct)) map[reader.GetString(0)] = reader.GetString(1);
        return map;
    }
}
