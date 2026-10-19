using System.Text.Json.Nodes;
using api_v2.Domain.Rules;

namespace api_v2.Application.Tables;

// One table as the Tables page reads it: its columns as objects rather than as the JSON they are kept in
public record UserTableDto(int Id, string Name, IReadOnlyList<FieldRule> Columns, int RowCount, string CreatedBy,
    DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt, DateTimeOffset? DeletedAt, int Version);

// One row as the page reads it: its values as the JSON object they are kept as
public record UserTableRowDto(int Id, JsonNode? Data, string CreatedBy, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);

// A page of rows and the whole count, which is what the pager needs
public record UserTablePage(int Total, int Page, int Size, IReadOnlyList<UserTableRowDto> Rows);

public abstract record CreateTableResult
{
    public sealed record Created(UserTableDto Table) : CreateTableResult;
    public sealed record Invalid(IReadOnlyDictionary<string, string[]> Errors) : CreateTableResult;
    public sealed record NameTaken(string Name) : CreateTableResult;
    public sealed record Limit : CreateTableResult;
}

public abstract record UpdateTableResult
{
    public sealed record Updated(UserTableDto Table) : UpdateTableResult;
    public sealed record NotFound : UpdateTableResult;
    public sealed record Stale : UpdateTableResult;
    public sealed record NameTaken(string Name) : UpdateTableResult;
    public sealed record Invalid(IReadOnlyDictionary<string, string[]> Errors) : UpdateTableResult;
    public sealed record RowsBlocked(string Message) : UpdateTableResult;
}

public abstract record DeleteTableResult
{
    public sealed record Deleted(int Id, DateTimeOffset KeptUntil) : DeleteTableResult;
    public sealed record NotFound : DeleteTableResult;
}

public abstract record RestoreTableResult
{
    public sealed record Restored(UserTableDto Table) : RestoreTableResult;
    public sealed record NotFound : RestoreTableResult;
    public sealed record NameTaken(string Name) : RestoreTableResult;
    public sealed record Limit : RestoreTableResult;
}

public abstract record RowsPageResult
{
    public sealed record Found(UserTablePage Page) : RowsPageResult;
    public sealed record NotFound : RowsPageResult;
}

public abstract record AddRowResult
{
    public sealed record Created(UserTableRowDto Row) : AddRowResult;
    public sealed record Invalid(IReadOnlyDictionary<string, string[]> Errors) : AddRowResult;
    public sealed record NotFound : AddRowResult;
    public sealed record Limit : AddRowResult;
}

public abstract record UpdateRowResult
{
    public sealed record Updated(UserTableRowDto Row) : UpdateRowResult;
    public sealed record NotFoundTable : UpdateRowResult;
    public sealed record NotFoundRow : UpdateRowResult;
    public sealed record Stale : UpdateRowResult;
    public sealed record Invalid(IReadOnlyDictionary<string, string[]> Errors) : UpdateRowResult;
}

public abstract record DeleteRowResult
{
    public sealed record Deleted(int RowId) : DeleteRowResult;
    public sealed record NotFound : DeleteRowResult;
}
