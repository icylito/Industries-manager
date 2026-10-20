using api_v2.Domain.Entities;
using api_v2.Domain.Scratchpad;
using api_v2.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;

namespace api_v2.Infrastructure.Files;

// Scratchpad files used to live on disk in scratchpad-files/ (or the folder Scratchpad:Files named). Their bytes now
// sit in the database, so this copies in any file whose row has no bytes yet. It only reads the folder and never
// writes or deletes there; once every row has its bytes it does nothing, and the folder can be deleted by hand.
public sealed class ScratchFileImport(AppDbContext db, IConfiguration config, IWebHostEnvironment env, ILogger<ScratchFileImport> log)
{
    public async Task RunAsync(CancellationToken ct)
    {
        var configured = config["Scratchpad:Files"];
        var folder = string.IsNullOrWhiteSpace(configured)
            ? Path.GetFullPath(Path.Combine(env.ContentRootPath, "..", "scratchpad-files"))
            : Path.GetFullPath(configured.Trim(), env.ContentRootPath);
        if (!Directory.Exists(folder)) return;

        var waiting = await db.ScratchFiles.AsNoTracking()
            .Where(f => f.Content == null)
            .Select(f => new { f.Id, f.StoredName })
            .ToListAsync(ct);
        if (waiting.Count == 0)
        {
            log.LogInformation("Every Scratchpad file is in the database, the old folder {Folder} can be deleted", folder);
            return;
        }

        var copied = 0;
        var missing = 0;
        foreach (var file in waiting)
        {
            // The stored name came from the API itself, but a name with a folder in it is never followed
            var path = file.StoredName.Length > 0 && file.StoredName == Path.GetFileName(file.StoredName)
                ? Path.Combine(folder, file.StoredName)
                : null;
            if (path is null || !File.Exists(path) || new FileInfo(path).Length > ScratchFileRules.MaxBytes)
            {
                missing++;
                continue;
            }

            // One save per file, so only one file's bytes are held at a time
            db.ScratchFileContents.Add(new ScratchFileContent { ScratchFileId = file.Id, Bytes = await File.ReadAllBytesAsync(path, ct) });
            await db.SaveChangesAsync(ct);
            db.ChangeTracker.Clear();
            copied++;
        }

        log.LogInformation("Copied {Copied} Scratchpad file(s) from {Folder} into the database, {Missing} weren't there to copy",
            copied, folder, missing);
    }
}
