namespace api_v2.Domain.Scratchpad;

// What a Scratchpad file may be and how it is named, kept apart from how it arrives or where it is stored.
// The page shows the refusal lines verbatim in the toast, so the wording here is the wording the person reads.
public static class ScratchFileRules
{
    // The limit the page tells people about
    public const long MaxBytes = 25L * 1024 * 1024;
    private const int MaxName = 260;
    private const int MaxContentType = 120;

    private static readonly HashSet<string> OfficeExtensions =
        [".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx"];
    private static readonly HashSet<string> TextExtensions = [".txt", ".md"];
    private static readonly HashSet<string> ScriptExtensions =
        [".exe", ".bat", ".cmd", ".ps1", ".js", ".vbs", ".msi", ".dll", ".jar", ".scr"];

    // Why a file of this kind can't go on the board, or null when it can. Decided from the name alone, so a refused
    // kind is answered before any of it is read and a huge Office file still gets the Office line.
    public static string? Refusal(string fileName)
    {
        var display = DisplayName(fileName);
        var extension = ExtensionOf(fileName);
        if (OfficeExtensions.Contains(extension)) return $"Word, PowerPoint and Excel files can't go on the board ({display}).";
        if (TextExtensions.Contains(extension)) return $"Text files can't go on the board ({display}). Copy the text and paste it instead.";
        if (ScriptExtensions.Contains(extension)) return $"That kind of file can't go on the board ({display}).";
        return null;
    }

    public static string TooBig(string display) => $"{display} is bigger than 25 MB.";

    // The original name is only shown on the card, so keep the file's own name, never a path from the client
    public static string DisplayName(string fileName)
    {
        var name = Path.GetFileName(fileName);
        name = new string(name.Where(c => !char.IsControl(c)).ToArray()).Trim();
        if (name.Length == 0) return "File";
        return name.Length > MaxName ? name[..MaxName] : name;
    }

    public static string ExtensionOf(string fileName) => Path.GetExtension(fileName).ToLowerInvariant();

    // A GUID plus the original extension is the only name on disk, so uploads never collide and the original
    // name can never become a path
    public static string StoredNameFor(string extension)
    {
        var safe = new string(extension.Where(char.IsLetterOrDigit).ToArray());
        if (safe.Length > 10) safe = safe[..10];
        return safe.Length == 0 ? Guid.NewGuid().ToString("N") : $"{Guid.NewGuid():N}.{safe}";
    }

    public static string ContentTypeOf(string? contentType)
    {
        var type = string.IsNullOrWhiteSpace(contentType) ? "application/octet-stream" : contentType.Trim();
        return type.Length > MaxContentType ? type[..MaxContentType] : type;
    }

    // Images and PDF render in place; everything else, SVG included, is offered as a download, so an odd type
    // never runs as a page
    public static bool ShowsInline(string contentType)
    {
        var media = contentType.Split(';')[0].Trim();
        return (media.StartsWith("image/", StringComparison.OrdinalIgnoreCase)
                && !media.Contains("svg", StringComparison.OrdinalIgnoreCase))
            || media.Equals("application/pdf", StringComparison.OrdinalIgnoreCase);
    }
}
