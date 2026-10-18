namespace api_v2.Application.Ports;

// The files uploaded to the Scratchpad, kept on disk outside the web root
public interface IScratchFiles
{
    // Writes at most `limit` bytes and answers how many it wrote, or -1 when the content is longer than that
    Task<long> WriteAsync(string storedName, Stream content, long limit, CancellationToken ct);

    // The stored file's bytes for reading, or null when it is no longer on disk
    Stream? OpenRead(string storedName);

    void Delete(string storedName);
}
