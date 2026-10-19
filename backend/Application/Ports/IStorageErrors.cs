namespace api_v2.Application.Ports;

// The few database refusals a person can cause and should hear about in plain words. Which exception means which is
// the database's business, so the answer to a failed request asks this port instead of knowing EF or Postgres.
public enum StorageError
{
    None,
    NameTaken,
    ChangedMeanwhile,
    TooLong,
    BadCharacter
}

public interface IStorageErrors
{
    // What the error (or anything inside it) says the database refused, None when it isn't one of these
    StorageError Classify(Exception error);
}
