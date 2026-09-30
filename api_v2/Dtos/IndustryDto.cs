using System.ComponentModel.DataAnnotations;

namespace api_v2.Dtos;

public record IndustryDto(
    int Id,
    string Name,
    string? Sector,
    decimal? Price,
    DateOnly? Release
);