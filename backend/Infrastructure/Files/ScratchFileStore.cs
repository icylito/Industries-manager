using api_v2.Application.Ports;
using Microsoft.AspNetCore.Hosting;

namespace api_v2.Infrastructure.Files;

// Where uploaded Scratchpad files live. Scratchpad:Files picks the folder; a blank key or a relative value
// lands at the repo root's scratchpad-files/, the same convention as BackupService.ResolveFolder. It is created
// when the API starts and has to stay outside the web root, so the only way to read a file is the endpoint that
// checks who is asking.
public class ScratchFileStore : IScratchFiles
{
    public string Root { get; }

    public ScratchFileStore(IConfiguration config, IWebHostEnvironment env)
    {
        var configured = config["Scratchpad:Files"];
        // A configured relative path is resolved against the content root, not the process working directory,
        // so ../scratchpad-files stays the repo root however the API is launched
        Root = string.IsNullOrWhiteSpace(configured)
            ? Path.GetFullPath(Path.Combine(env.ContentRootPath, "..", "scratchpad-files"))
            : Path.GetFullPath(configured.Trim(), env.ContentRootPath);

        // A folder under the web root would be handed straight to the browser, so refuse to start that way
        if (!string.IsNullOrEmpty(env.WebRootPath) && Inside(Path.GetFullPath(env.WebRootPath), Root))
        {
            throw new InvalidOperationException("Scratchpad:Files has to be outside the web root, see appsettings");
        }

        Directory.CreateDirectory(Root);
    }

    // The stored name is a GUID plus extension written by this class, so a path can never come out of the row
    public string PathFor(string storedName)
    {
        if (storedName.Length == 0 || storedName != Path.GetFileName(storedName) || storedName.Contains(".."))
        {
            throw new InvalidOperationException("The stored file name is not a plain name");
        }
        return Path.Combine(Root, storedName);
    }

    // Writes at most `limit` bytes and answers how many it wrote, or -1 when the content is longer than that.
    // Nothing is left on disk when it is too long or the write fails, so a refused upload leaves no litter.
    public async Task<long> WriteAsync(string storedName, Stream content, long limit, CancellationToken ct)
    {
        var tooBig = false;
        long total = 0;
        try
        {
            await using (var target = new FileStream(PathFor(storedName), FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                var buffer = new byte[81920];
                int read;
                while ((read = await content.ReadAsync(buffer, ct)) > 0)
                {
                    total += read;
                    if (total > limit) { tooBig = true; break; }
                    await target.WriteAsync(buffer.AsMemory(0, read), ct);
                }
            }
        }
        catch
        {
            Delete(storedName);
            throw;
        }

        if (!tooBig) return total;
        Delete(storedName);
        return -1;
    }

    // The stored file's bytes, or null when it is no longer on disk. A page only ever reads a file the
    // endpoint has already said the person owns.
    public Stream? OpenRead(string storedName)
    {
        var path = PathFor(storedName);
        return File.Exists(path) ? new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read) : null;
    }

    public void Delete(string storedName)
    {
        try
        {
            var path = PathFor(storedName);
            if (File.Exists(path)) File.Delete(path);
        }
        catch (IOException)
        {
            // The row is already gone, so an orphan file is only litter, not something the API can serve
        }
        catch (UnauthorizedAccessException)
        {
        }
    }

    private static bool Inside(string parent, string path)
    {
        var relative = Path.GetRelativePath(parent, path);
        return !relative.StartsWith("..") && !Path.IsPathRooted(relative);
    }
}
