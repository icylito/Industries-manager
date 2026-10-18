namespace api_v2.Presentation.Contracts;

public record LoginBody(string? Username, string? Password);
public record PasswordBody(string? Current, string? New);
