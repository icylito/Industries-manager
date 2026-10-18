namespace api_v2.Presentation.Contracts;

public record AskBody(string? Title, string? Details, string? Code = null);
public record ColumnAsk(string? Label, string? Type, string? FieldKey, string? Details);
public record TypeAsk(string? FieldKey, string? Type);
public record StatusBody(string? Status);
public record MessageBody(string? Body);
