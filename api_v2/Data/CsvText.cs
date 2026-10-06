namespace api_v2.Data;

// CSV cells that open cleanly in Excel, used by the History download and the backup Excel file
public static class CsvText
{
    // A leading quote stops Excel treating the cell as a formula. Numbers stay numbers.
    public static string GuardFormula(string text) =>
        text.Length > 0 && text[0] is '=' or '+' or '-' or '@' or '\t' or '\r' ? "'" + text : text;

    public static string Cell(string text) =>
        text.IndexOfAny([',', '"', '\n', '\r']) >= 0 ? $"\"{text.Replace("\"", "\"\"")}\"" : text;
}
