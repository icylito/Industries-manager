namespace api_v2.Application.Exceptions;

// Thrown when a second backup is asked for while one is already running.
public sealed class BackupBusyException : Exception
{
    public BackupBusyException() : base("A backup is already running, try again in a minute") { }
}

// An uploaded backup file that was turned away, with the status the page should get. The message is shown as it is.
public sealed class BackupUploadException(string message, int status) : Exception(message)
{
    public int Status { get; } = status;

    // The backup already in the list, when the file is one of those. The page scrolls to it.
    public string? ExistingId { get; init; }
}

// Thrown when a restore is refused before anything changes, the page shows the message as a conflict.
public sealed class BackupRefusedException(string message) : Exception(message);
