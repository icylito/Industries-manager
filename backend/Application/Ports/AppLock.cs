namespace api_v2.Application.Ports;

// Advisory locks belong to the database session, so a crash frees them, and they work if the API runs twice.
// The numbers are part of the protocol: they are the keys Postgres takes the lock on, so they never change.
public enum AppLock { Table = 1, Rules = 2, Requests = 3, Settings = 4, Scratchpad = 5, UserTables = 6 }
