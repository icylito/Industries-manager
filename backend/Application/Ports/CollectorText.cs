namespace api_v2.Application.Ports;

// The text rules the collector keeps to. A version's reason is clipped when it is saved and again when a list
// carries it, so one oversized note saved before the limit existed can't slow the History page down.
public static class CollectorText
{
    // The longest a saved version's reason is kept. A reason is a few words, or for a database update a list of
    // migration names. The restore note is held to a much shorter limit at the door (HistoryService.NoteMax), this
    // is the backstop so no caller can ever put a huge text in a list every History visit has to carry.
    public const int ReasonMax = 1000;

    // The reason cut to ReasonMax, with an ellipsis, never through the middle of a character
    public static string Clip(string reason)
    {
        if (reason.Length <= ReasonMax) return reason;
        var cut = ReasonMax - 1;
        if (char.IsHighSurrogate(reason[cut - 1])) cut--;
        return reason[..cut] + "…";
    }
}
