namespace api_v2.Data;

public static class DatabaseReady
{
    // A background job waits here until the migrations are done. False when they failed for good, or the API is
    // stopping, so the job has nothing to do.
    public static async Task<bool> WaitUntilReadyAsync(this DatabaseStatus status, CancellationToken ct)
    {
        while (status.State != DatabaseState.Ready)
        {
            if (status.State == DatabaseState.Failed) return false;
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(2), ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                return false;
            }
        }
        return true;
    }
}
