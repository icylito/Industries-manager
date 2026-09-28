using System.ComponentModel.DataAnnotations;

namespace api_v2.Dtos;

public record UpdateIndustry(
    [Required][StringLength(50)] string Name,
    [StringLength(25)] string? Sector,
    [Range(0, 10)] decimal? Price,
    DateOnly Release
);