namespace api_v2.Presentation.Contracts;

public record NewUserBody(string? Username, string? Role);
public record UserChangeBody(string? Username, string? Role, bool? Disabled);
public record NoteBody(string? Text);
