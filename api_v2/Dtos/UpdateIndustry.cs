using System.Text.Json;

namespace api_v2.Dtos;

// Limits come from the rules in the database (GET /schema), checked in Endpoints/IndustryEndpoints.cs
// Extra holds the custom fields from the Fields page, keyed by field key
public record UpdateIndustry(
    string Name,
    string? Sector,
    decimal? Price,
    DateOnly? Release,
    Dictionary<string, JsonElement>? Extra = null
);
