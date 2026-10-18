using System.Text.Json;

namespace api_v2.Presentation.Contracts;

public record MySettings(JsonElement? Shortcuts, JsonElement? Mouse, string? Theme);
