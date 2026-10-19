using System.Text;

namespace api_v2.Domain.Rules;

// Reads the sectors list out of scripts/config.toml. Only that one key, no TOML package.
public static class SectorList
{
    public static bool TryRead(string text, out List<string> sectors, out string problem)
    {
        sectors = [];
        problem = "";
        if (text.Length > 0 && text[0] == '\uFEFF') text = text[1..];

        var section = Section(text, "fields");
        if (section is null)
        {
            problem = "no [fields] section";
            return false;
        }

        var start = IndexOfValue(section, "sectors");
        if (start < 0)
        {
            problem = "no sectors list";
            return false;
        }

        var i = SkipSpaceAndComments(section, start);
        if (i >= section.Length || section[i] != '[')
        {
            problem = "sectors is not a list";
            return false;
        }
        i++;

        var raw = new List<string>();
        var closed = false;
        while (i < section.Length)
        {
            i = SkipSpaceAndComments(section, i);
            if (i >= section.Length) break;
            if (section[i] == ']')
            {
                closed = true;
                break;
            }
            if (section[i] == ',')
            {
                i++;
                continue;
            }
            if (section[i] != '"')
            {
                problem = "a sector isn't in quotes";
                return false;
            }
            if (!ReadString(section, ref i, out var value))
            {
                problem = "a sector quote never closed";
                return false;
            }
            raw.Add(value);
        }

        if (!closed)
        {
            problem = "the sectors list never closed";
            return false;
        }

        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var value in raw)
        {
            var trimmed = value.Trim();
            if (trimmed.Length == 0 || !seen.Add(trimmed)) continue;
            sectors.Add(trimmed);
        }
        return true;
    }

    private static string? Section(string text, string name)
    {
        var lines = text.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n');
        var found = false;
        var body = new StringBuilder();
        foreach (var line in lines)
        {
            var header = Header(line);
            if (header is not null)
            {
                if (found) break;
                found = string.Equals(header, name, StringComparison.OrdinalIgnoreCase);
                continue;
            }
            if (found) body.Append(line).Append('\n');
        }
        return found ? body.ToString() : null;
    }

    private static string? Header(string line)
    {
        var i = 0;
        while (i < line.Length && char.IsWhiteSpace(line[i])) i++;
        if (i >= line.Length || line[i] != '[') return null;
        var end = line.IndexOf(']', i + 1);
        if (end < 0) return null;
        var rest = line[(end + 1)..].Trim();
        if (rest.Length > 0 && rest[0] != '#') return null;
        return line[(i + 1)..end].Trim();
    }

    // Where the value after `key =` starts, or -1
    private static int IndexOfValue(string section, string key)
    {
        var i = 0;
        while (i < section.Length)
        {
            i = SkipSpaceAndComments(section, i);
            if (i >= section.Length) return -1;
            if (MatchKey(section, i, key))
            {
                i += key.Length;
                i = SkipSpace(section, i);
                if (i < section.Length && section[i] == '=') return i + 1;
            }
            while (i < section.Length && section[i] != '\n') i++;
        }
        return -1;
    }

    private static bool MatchKey(string text, int i, string key)
    {
        if (i + key.Length > text.Length) return false;
        if (!text.AsSpan(i, key.Length).Equals(key, StringComparison.OrdinalIgnoreCase)) return false;
        if (i > 0 && (char.IsLetterOrDigit(text[i - 1]) || text[i - 1] == '_')) return false;
        var after = i + key.Length;
        return after >= text.Length || !(char.IsLetterOrDigit(text[after]) || text[after] == '_');
    }

    private static int SkipSpace(string text, int i)
    {
        while (i < text.Length && char.IsWhiteSpace(text[i])) i++;
        return i;
    }

    private static int SkipSpaceAndComments(string text, int i)
    {
        while (i < text.Length)
        {
            if (char.IsWhiteSpace(text[i]))
            {
                i++;
                continue;
            }
            if (text[i] == '#')
            {
                while (i < text.Length && text[i] != '\n') i++;
                continue;
            }
            break;
        }
        return i;
    }

    private static bool ReadString(string text, ref int i, out string value)
    {
        value = "";
        if (text[i] != '"') return false;
        i++;
        var sb = new StringBuilder();
        while (i < text.Length)
        {
            var ch = text[i++];
            if (ch == '"')
            {
                value = sb.ToString();
                return true;
            }
            if (ch == '\n') return false;
            if (ch == '\\' && i < text.Length)
            {
                var esc = text[i++];
                sb.Append(esc switch
                {
                    'n' => '\n',
                    't' => '\t',
                    'r' => '\r',
                    '"' => '"',
                    '\\' => '\\',
                    _ => esc
                });
                continue;
            }
            sb.Append(ch);
        }
        return false;
    }
}
