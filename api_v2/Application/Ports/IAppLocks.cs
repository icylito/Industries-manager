namespace api_v2.Application.Ports;

// Changes take turns: a lock that can't be taken becomes AppBusyException, answered 503.
public interface IAppLocks
{
    // One lock for everyone: changes to the table, the rules, the requests and the settings take turns
    Task<IAsyncDisposable> TakeAsync(AppLock which, CancellationToken ct = default);

    // One lock per person within one area, so one person's saves take turns without making anyone else wait
    Task<IAsyncDisposable> TakeAsync(AppLock which, int person, CancellationToken ct = default);
}
