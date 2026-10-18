namespace api_v2.Application.Ports;

// The answer of the one-step restore: what it put back, or that the database refused the rows because two of them
// share a name. Nothing is kept in either case.
public abstract record HistoryRestoreRun
{
    public sealed record Done(int Restored, bool RulesRestored, int? RequestId, int RowsBefore) : HistoryRestoreRun;
    public sealed record NameClash : HistoryRestoreRun;
}

// Puts a version back in one transaction: its rows, the rules it was saved under, and the developer request that
// says the old layout differs. The caller has already taken the table and rules locks, so the change queues behind
// any other restore or import rather than failing.
public interface IHistoryRestoreRunner
{
    Task<HistoryRestoreRun> RunAsync(VersionDetail version, ImportPlan plan, long versionId, string by, CancellationToken ct);
}
