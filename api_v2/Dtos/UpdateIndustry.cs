using System.Text.Json;

namespace api_v2.Dtos;

// Limits come from the rules in the database (GET /schema), checked in Endpoints/IndustryEndpoints.cs
// Extra holds the custom fields from the Fields page, keyed by field key.
// Original is the row as the page showed it when Edit was pressed. When it's sent and the row has changed since,
// the save is refused instead of quietly writing over someone else's change. Scripts that leave it out save as before.
public record UpdateIndustry(
    string Name,
    string? Sector,
    decimal? Price,
    DateOnly? Release,
    Dictionary<string, JsonElement>? Extra = null,
    IndustryOriginal? Original = null
);

public record IndustryOriginal(string Name, string? Sector, decimal? Price, DateOnly? Release, JsonElement? Extra = null);
