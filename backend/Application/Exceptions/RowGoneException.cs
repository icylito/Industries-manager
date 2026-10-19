namespace api_v2.Application.Exceptions;

// The row was deleted by someone else between reading it and saving the change.
public sealed class RowGoneException : Exception;
