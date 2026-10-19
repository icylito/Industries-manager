using api_v2.Application.Ports;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace api_v2.Infrastructure.Persistence;

// Reads EF's and Postgres's exceptions for the refusals the page explains. The first Postgres error in the chain
// decides, and a unique name wins over a concurrent change, the order the answers always had.
public sealed class StorageErrors : IStorageErrors
{
    public StorageError Classify(Exception error)
    {
        PostgresException? postgres = null;
        var concurrency = false;
        for (Exception? current = error; current is not null; current = current.InnerException)
        {
            switch (current)
            {
                case PostgresException pg:
                    postgres ??= pg;
                    break;
                case DbUpdateConcurrencyException:
                    concurrency = true;
                    break;
            }
        }

        if (postgres?.SqlState == PostgresErrorCodes.UniqueViolation) return StorageError.NameTaken;
        if (concurrency) return StorageError.ChangedMeanwhile;
        if (postgres?.SqlState == PostgresErrorCodes.ProgramLimitExceeded) return StorageError.TooLong;
        if (postgres?.SqlState is PostgresErrorCodes.UntranslatableCharacter or PostgresErrorCodes.CharacterNotInRepertoire)
        {
            return StorageError.BadCharacter;
        }
        return StorageError.None;
    }
}
