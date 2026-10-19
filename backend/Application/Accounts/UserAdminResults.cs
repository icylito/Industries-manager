using api_v2.Domain.Entities;

namespace api_v2.Application.Accounts;

// One person in the admin list, and whether a note about them exists
public record AdminUserRow(User Row, bool HasNotes);

public abstract record CreateUserResult
{
    public sealed record Created(User Row, string TemporaryPassword) : CreateUserResult;
    public sealed record Invalid(IReadOnlyDictionary<string, string[]> Errors) : CreateUserResult;
    public sealed record NameTaken : CreateUserResult;
}

public abstract record ResetPasswordResult
{
    public sealed record Reset(User Row, string TemporaryPassword) : ResetPasswordResult;
    public sealed record NotFound : ResetPasswordResult;
    public sealed record OwnAccount : ResetPasswordResult;
}

public abstract record UpdateUserResult
{
    public sealed record Updated(User Row) : UpdateUserResult;
    public sealed record NotFound : UpdateUserResult;
    public sealed record OwnAccount : UpdateUserResult;
    public sealed record Invalid(IReadOnlyDictionary<string, string[]> Errors) : UpdateUserResult;
    public sealed record NameTaken : UpdateUserResult;
    public sealed record LastAdmin : UpdateUserResult;
}

public abstract record DeleteUserResult
{
    public sealed record Deleted(User Row) : DeleteUserResult;
    public sealed record NotFound : DeleteUserResult;
    public sealed record OwnAccount : DeleteUserResult;
    public sealed record LastAdmin : DeleteUserResult;
}

public abstract record ListNotesResult
{
    public sealed record Found(IReadOnlyList<UserNote> Notes) : ListNotesResult;
    public sealed record NotFound : ListNotesResult;
}

public abstract record AddNoteResult
{
    public sealed record Added(UserNote Note) : AddNoteResult;
    public sealed record NotFound : AddNoteResult;
    public sealed record Invalid(IReadOnlyDictionary<string, string[]> Errors) : AddNoteResult;
}

public abstract record DeleteNoteResult
{
    public sealed record Deleted : DeleteNoteResult;
    public sealed record NotFound : DeleteNoteResult;
}
