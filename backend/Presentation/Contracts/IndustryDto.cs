using System.Text.Json;

namespace api_v2.Presentation.Contracts;

public record IndustryDto(
    int Id,
    string Name,
    string? Sector,
    decimal? Price,
    DateOnly? Release,
    int? DuplicateOf = null,
    int? ImportedFrom = null,
    List<string>? LostFields = null,
    JsonElement? Extra = null
);
