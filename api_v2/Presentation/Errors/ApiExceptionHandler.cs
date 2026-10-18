using api_v2.Application.Exceptions;
using api_v2.Application.Health;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace api_v2.Presentation.Errors;

// What the API answers when a request throws, and how loudly it says so in the log.
// Input a person got wrong, a name already taken, someone else changing the same row and a busy lock are all
// expected: the page gets a plain sentence and the log gets one short line. Only what nobody planned for is
// logged as an error with its stack, so a real failure is never lost among a client's bad requests.
public sealed class ApiExceptionHandler(ILogger<ApiExceptionHandler> log) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext context, Exception exception, CancellationToken ct)
    {
        var (status, title, detail, expected) = Describe(exception);
        if (expected)
        {
            log.LogInformation("{Method} {Path} answered {Status} {Title}", context.Request.Method, Printable(context.Request.Path.Value), status, title);
        }
        else
        {
            log.LogError(exception, "Request failed with {ExceptionType}", exception.GetType().Name);
        }

        await Results.Problem(detail, statusCode: status, title: title).ExecuteAsync(context);
        return true;
    }

    // The answer for an exception, and whether it was something the API expects to happen now and then.
    // The wording and the codes are what Program.cs always answered, only the log level is new.
    public static (int Status, string Title, string Detail, bool Expected) Describe(Exception? error)
    {
        PostgresException? postgres = null;
        var busy = false;
        var concurrency = false;
        var badRequest = false;

        for (var current = error; current is not null; current = current.InnerException)
        {
            switch (current)
            {
                case AppBusyException:
                    busy = true;
                    break;
                case PostgresException pg:
                    postgres ??= pg;
                    break;
                case DbUpdateConcurrencyException:
                    concurrency = true;
                    break;
                case BadHttpRequestException:
                    badRequest = true;
                    break;
            }
        }

        if (busy)
        {
            return (StatusCodes.Status503ServiceUnavailable, "Busy",
                "Someone else is changing this right now. Try again in a moment", true);
        }
        if (postgres?.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            return (StatusCodes.Status409Conflict, "Already taken", "That name is already taken", true);
        }
        if (concurrency)
        {
            return (StatusCodes.Status409Conflict, "Changed meanwhile",
                "Someone else changed or deleted this at the same time. Reload and try again", true);
        }
        if (postgres?.SqlState == PostgresErrorCodes.ProgramLimitExceeded)
        {
            return (StatusCodes.Status400BadRequest, "Too long", "That value is too long to save", true);
        }
        if (postgres?.SqlState is PostgresErrorCodes.UntranslatableCharacter or PostgresErrorCodes.CharacterNotInRepertoire)
        {
            return (StatusCodes.Status400BadRequest, "Bad character", "The text has a character that can't be saved", true);
        }
        if (badRequest)
        {
            return (StatusCodes.Status400BadRequest, "Couldn't read it",
                "The request couldn't be read. Check the values and try again", true);
        }
        return (StatusCodes.Status500InternalServerError, "Something went wrong",
            "Something went wrong. Nothing was saved if you see this, try again or tell a developer", false);
    }

    // A path comes from the caller, so a line break in it must not be able to make a second log line
    private static string Printable(string? path) =>
        string.IsNullOrEmpty(path) ? "/" : new string(path.Select(c => char.IsControl(c) ? '?' : c).ToArray());
}
