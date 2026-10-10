using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using api_v2.Data;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;

namespace api_v2.Rules;

// Names are cleaned before they are saved. Two names are compared by the one name rule (Same below): in Postgres with
// the collation name_rule when the database holds them, in C# for lists the page sends, like field labels.
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
    // same when they match ignoring capital letters, accents, spaces, punctuation and symbols, in any script, by ICU,
    // the Unicode library Postgres, .NET and browsers all use: "Acme, Inc.", "ACME inc" and "acme-inc" are one name,
    // "ΟΔΟΣ" and "οδος" are one, but Hindi "काम" and "कम" stay two words. The database has the same rule as the
    // collation name_rule (Migrations/*_OneNameRule.cs, locale und-u-ka-shifted-ks-level1-kv-currency), which the
    // unique indexes use; the page has it in services/name-key.ts. testing/check_names.py checks the three agree.
    private static readonly CompareInfo Rule = CultureInfo.InvariantCulture.CompareInfo;
    private const CompareOptions RuleOptions = CompareOptions.IgnoreCase | CompareOptions.IgnoreNonSpace
        | CompareOptions.IgnoreSymbols | CompareOptions.IgnoreKanaType | CompareOptions.IgnoreWidth;

    public static bool Same(string? a, string? b) => Rule.Compare(a ?? "", b ?? "", RuleOptions) == 0;

    // A name of only symbols, spaces or punctuation is no name at all
    public static bool HasNoLetters(string? name) => Same(name, "");

    // A value two names share exactly when they are the same name, for grouping names in memory
    public static string Key(string? name) => Convert.ToHexString(Rule.GetSortKey(name ?? "", RuleOptions).KeyData);

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
            WHERE "DuplicateOf" IS NULL AND "Name" COLLATE name_rule = {name} AND "Id" <> {exceptId ?? 0}
            """).SingleAsync(ct);
        return count > 0;
    }

    // The key of each name, for grouping a batch of names by the rule
    public static Dictionary<string, string> Keys(IEnumerable<string> names) =>
        names.Distinct().ToDictionary(name => name, Key);
}
