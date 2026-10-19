namespace api_v2.Presentation.Contracts;

public record PinBody(bool Pinned);
public record RestoreBody(string? Note);
// SkipDuplicates leaves out rows whose name is already in the table, or shows up twice in the import.
// null means the caller didn't say. That is only accepted when nothing in the import has a name already in the table,
// otherwise the answer is a 409 asking for a choice, so an empty body can never quietly add every row again.
public record ImportBody(bool Confirm, bool? SkipDuplicates = null);
