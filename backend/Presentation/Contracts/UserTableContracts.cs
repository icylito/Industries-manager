using System.Text.Json;
using api_v2.Domain.Tables;

namespace api_v2.Presentation.Contracts;

public record NewTableBody(string? Name, List<ColumnInput>? Columns);
public record EditTableBody(string? Name, List<ColumnInput>? Columns, int? Version);
public record RowBody(Dictionary<string, JsonElement>? Values, DateTimeOffset? UpdatedAt);
