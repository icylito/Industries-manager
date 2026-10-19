namespace api_v2.Application.Exceptions;

// Thrown when an advisory lock can't be taken in time, answered 503 Busy.
public class AppBusyException : Exception;