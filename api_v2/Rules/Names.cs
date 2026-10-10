using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using api_v2.Data;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;

namespace api_v2.Rules;

// Names are cleaned before they are saved. Two names are compared by their key (Key below): in Postgres with the
// function name_key when the database holds them, in C# with Key for lists the page sends, like field labels.
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

    // One name rule for everything with a name: companies, tables, fields, columns and accounts. Two names are the
    // same when they match after ignoring capital letters, accents, spaces, punctuation and symbols, in any script:
    // "Acme, Inc.", "ACME inc" and "acme-inc" are one name, "شركة" stays "شركة". The database has the same rule as
    // the function name_key (Migrations/*_OneNameRule.cs), which the unique indexes use, so the two never disagree.
    // An empty key (a name of only symbols) is no name at all.
    public static string Key(string? name)
    {
        if (string.IsNullOrEmpty(name)) return "";
        var builder = new StringBuilder(name.Length);
        foreach (var ch in name.ToLowerInvariant().Normalize(NormalizationForm.FormKD))
        {
            if (char.IsLetterOrDigit(ch)) builder.Append(ch);
        }
        return builder.ToString();
    }

    public const string NoKeyMessage = "A name needs at least one letter or digit";

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
            WHERE "DuplicateOf" IS NULL AND name_key("Name") = name_key({name}) AND "Id" <> {exceptId ?? 0}
            """).SingleAsync(ct);
        return count > 0;
    }

    public static async Task<bool> SameAsync(AppDbContext db, string a, string b, CancellationToken ct = default)
    {
        return await db.Database.SqlQuery<bool>($"""
            SELECT name_key({a}) = name_key({b}) AS "Value"
            """).SingleAsync(ct);
    }

    public static async Task<Dictionary<string, string>> KeysAsync(NpgsqlConnection conn, NpgsqlTransaction? tx,
        IEnumerable<string> names, CancellationToken ct = default)
    {
        var list = names.Distinct().ToArray();
        var map = new Dictionary<string, string>();
        if (list.Length == 0) return map;
        await using var cmd = new NpgsqlCommand("""SELECT n, name_key(n) FROM unnest(@names) AS n""", conn, tx);
        cmd.Parameters.Add(new NpgsqlParameter("names", NpgsqlDbType.Array | NpgsqlDbType.Text) { Value = list });
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct)) map[reader.GetString(0)] = reader.GetString(1);
        return map;
    }
}
