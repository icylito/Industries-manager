namespace api_v2.Dtos;

// Limits come from the rules in the database (GET /schema), checked in Endpoints/IndustryEndpoints.cs
public record UpdateIndustry(
    string Name,
    string? Sector,
    decimal? Price,
    DateOnly? Release
);