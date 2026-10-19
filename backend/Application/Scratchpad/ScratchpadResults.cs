using System.Text.Json.Nodes;
using api_v2.Application.Ports;
using api_v2.Domain.Entities;

namespace api_v2.Application.Scratchpad;

// One board as the editor loads it. The document and the view are read as JSON here, so the page gets them as
// objects rather than as the strings they are stored in.
public record BoardDetail(int Id, string Name, bool Pinned, JsonNode? Document, JsonNode? View,
    DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);

public abstract record CreateBoardResult
{
    public sealed record Created(ScratchBoard Board) : CreateBoardResult;
    public sealed record Invalid(IReadOnlyDictionary<string, string[]> Errors) : CreateBoardResult;
    public sealed record TooMany : CreateBoardResult;
}

public abstract record SaveBoardResult
{
    public sealed record Saved(DateTimeOffset UpdatedAt) : SaveBoardResult;
    public sealed record NotFound : SaveBoardResult;
    public sealed record ChangedMeanwhile : SaveBoardResult;
    public sealed record Invalid(IReadOnlyDictionary<string, string[]> Errors) : SaveBoardResult;
}

public abstract record ChangeBoardResult
{
    public sealed record Changed(ScratchBoardBrief Board) : ChangeBoardResult;
    public sealed record NotFound : ChangeBoardResult;
    public sealed record Invalid(IReadOnlyDictionary<string, string[]> Errors) : ChangeBoardResult;
}

public abstract record DeleteBoardResult
{
    public sealed record Deleted : DeleteBoardResult;
    public sealed record NotFound : DeleteBoardResult;
    public sealed record Pinned : DeleteBoardResult;
}

public abstract record TrayResult
{
    public sealed record Changed(JsonArray Items) : TrayResult;
    public sealed record Invalid(IReadOnlyDictionary<string, string[]> Errors) : TrayResult;
}
