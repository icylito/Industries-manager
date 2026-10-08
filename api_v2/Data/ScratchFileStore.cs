using Microsoft.AspNetCore.Hosting;

namespace api_v2.Data;

// Where uploaded Scratchpad files live. Scratchpad:Files picks the folder; a blank key or a relative value
// lands at the repo root's scratchpad-files/, the same convention as BackupService.ResolveFolder. It is created
// when the API starts and has to stay outside the web root, so the only way to read a file is the endpoint that
// checks who is asking.
public class ScratchFileStore
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

    public async Task WriteAsync(string storedName, Stream content, CancellationToken ct)
    {
        await using var target = new FileStream(PathFor(storedName), FileMode.CreateNew, FileAccess.Write, FileShare.None);
        await content.CopyToAsync(target, ct);
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
