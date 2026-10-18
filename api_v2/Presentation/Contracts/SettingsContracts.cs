using System.Text.Json;
using api_v2.Application.Settings;
using api_v2.Domain.Rules;

namespace api_v2.Presentation.Contracts;

public record SettingsFile(string? App, int? Format, DateTimeOffset? ExportedAt, Retention? Retention, List<FieldRule>? Fields);
