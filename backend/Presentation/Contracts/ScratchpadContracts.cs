using System.Text.Json;

namespace api_v2.Presentation.Contracts;

public record BoardSave(JsonElement Document, DateTimeOffset? UpdatedAt);
public record NewBoard(string? Name, JsonElement? Document);
public record BoardChange(string? Name, bool? Pinned, JsonElement? View);
public record BoardSummary(int Id, string Name, bool Pinned, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt, int Things);
