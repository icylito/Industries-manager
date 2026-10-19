using System.Text.Json;
using api_v2.Domain.Entities;

namespace api_v2.Application.Industries;

// What the page sends to add a row, before the rules have read it
public record NewRow(string? Name, string? Sector, decimal? Price, DateOnly? Release, Dictionary<string, JsonElement>? Extra);

// The row as the page showed it when Edit was pressed
public record RowSeen(string Name, string? Sector, decimal? Price, DateOnly? Release, JsonElement? Extra);

// What the page sends to change a row
public record RowEdit(string? Name, string? Sector, decimal? Price, DateOnly? Release,
    Dictionary<string, JsonElement>? Extra, RowSeen? Original);

public abstract record AddIndustryResult
{
    public sealed record Added(Industry Row) : AddIndustryResult;
    public sealed record Invalid(IReadOnlyDictionary<string, string[]> Errors) : AddIndustryResult;
    public sealed record NameTaken : AddIndustryResult;
    public sealed record HistoryDown : AddIndustryResult;
}

public abstract record UpdateIndustryResult
{
    public sealed record Updated : UpdateIndustryResult;
    public sealed record NotFound : UpdateIndustryResult;
    public sealed record Invalid(IReadOnlyDictionary<string, string[]> Errors) : UpdateIndustryResult;
    public sealed record ChangedMeanwhile : UpdateIndustryResult;
    public sealed record NameTaken : UpdateIndustryResult;
    public sealed record HistoryDown : UpdateIndustryResult;
}

public abstract record DeleteIndustryResult
{
    public sealed record Deleted(Industry Row) : DeleteIndustryResult;
    public sealed record NotFound : DeleteIndustryResult;
    public sealed record HistoryDown : DeleteIndustryResult;
}
