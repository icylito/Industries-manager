using api_v2.Domain.Entities;

namespace api_v2.Application.Requests;

public abstract record AskRequestResult
{
    public sealed record Created(DevRequest Request) : AskRequestResult;
    public sealed record Existing(DevRequest Request) : AskRequestResult;
    public sealed record Invalid(IReadOnlyDictionary<string, string[]> Errors) : AskRequestResult;
}

public abstract record GetRequestResult
{
    public sealed record Found(DevRequest Request, IReadOnlyList<RequestMessage> Messages) : GetRequestResult;
    public sealed record NotFound : GetRequestResult;
}

public abstract record AddMessageResult
{
    public sealed record Added(RequestMessage Message, string Status) : AddMessageResult;
    public sealed record NotFound : AddMessageResult;
    public sealed record Forbidden : AddMessageResult;
    public sealed record Invalid(IReadOnlyDictionary<string, string[]> Errors) : AddMessageResult;
}

public abstract record SetStatusResult
{
    public sealed record Updated(DevRequest Request) : SetStatusResult;
    public sealed record NotFound : SetStatusResult;
    public sealed record Invalid(IReadOnlyDictionary<string, string[]> Errors) : SetStatusResult;
    public sealed record Conflict(int OtherId) : SetStatusResult;
}
