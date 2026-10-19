using api_v2.Application.Ports;
using api_v2.Application.Scratchpad;
using api_v2.Domain.Entities;
using Xunit;

namespace api_v2.Tests.Application;

// A use case run against ports kept in memory: no database, no disk, no HTTP. This is what the split buys.
public sealed class ScratchFileServiceTests
{
    private readonly MemoryRows rows = new();
    private readonly MemoryFiles files = new();
    private ScratchFileService Service => new(rows, files);

    [Fact]
    public async Task A_saved_file_has_its_row_and_its_bytes()
    {
        var result = await Service.SaveAsync(7, "photo.png", "image/png", new MemoryStream([1, 2, 3]), default);

        var saved = Assert.IsType<SaveFileResult.Saved>(result).File;
        Assert.Equal("photo.png", saved.Name);
        Assert.Equal(3, saved.SizeBytes);
        Assert.Single(rows.All);
        Assert.True(files.Has(rows.All[0].StoredName));
    }

    [Fact]
    public async Task Too_big_leaves_no_row()
    {
        files.TooBig = true;
        var result = await Service.SaveAsync(7, "huge.png", "image/png", new MemoryStream([1]), default);

        Assert.Equal("huge.png is bigger than 25 MB.", Assert.IsType<SaveFileResult.TooBig>(result).Message);
        Assert.Empty(rows.All);
    }

    [Fact]
    public async Task When_the_row_cannot_be_saved_the_bytes_go_too()
    {
        rows.FailSave = true;
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            Service.SaveAsync(7, "photo.png", "image/png", new MemoryStream([1]), default));
        Assert.Empty(files.Stored);
    }

    [Fact]
    public async Task Nobody_reads_or_deletes_someone_elses_file()
    {
        var saved = (SaveFileResult.Saved)await Service.SaveAsync(7, "photo.png", "image/png", new MemoryStream([1]), default);

        Assert.Null(await Service.OpenAsync(saved.File.Id, 8, default));
        Assert.False(await Service.DeleteAsync(saved.File.Id, 8, default));
        Assert.NotNull(await Service.OpenAsync(saved.File.Id, 7, default));
        Assert.True(await Service.DeleteAsync(saved.File.Id, 7, default));
        Assert.Empty(files.Stored);
    }

    private sealed class MemoryRows : IScratchFilesStore
    {
        public List<ScratchFile> All { get; } = [];
        private readonly List<ScratchFile> pending = [];
        private readonly List<ScratchFile> removed = [];
        public bool FailSave { get; set; }

        public Task<IReadOnlyList<int>> OwnersAsync(CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<int>>(All.Select(f => f.UserId).Distinct().ToList());

        public Task<IReadOnlyList<ScratchFileExpired>> MarkAndFindExpiredAsync(int userId, DateTimeOffset now, TimeSpan grace, CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<ScratchFileExpired>>([]);

        public Task DeleteAsync(int fileId, CancellationToken ct)
        {
            All.RemoveAll(f => f.Id == fileId);
            return Task.CompletedTask;
        }

        public Task<ScratchFile?> FindAsync(int id, CancellationToken ct) => Task.FromResult(All.FirstOrDefault(f => f.Id == id));

        public void Add(ScratchFile file) => pending.Add(file);

        public void Remove(ScratchFile file) => removed.Add(file);

        public Task SaveAsync(CancellationToken ct)
        {
            if (FailSave) throw new InvalidOperationException("The database refused");
            foreach (var file in pending)
            {
                file.Id = All.Count + 1;
                All.Add(file);
            }
            foreach (var file in removed) All.Remove(file);
            pending.Clear();
            removed.Clear();
            return Task.CompletedTask;
        }
    }

    private sealed class MemoryFiles : IScratchFiles
    {
        public Dictionary<string, byte[]> Stored { get; } = [];
        public bool TooBig { get; set; }

        public bool Has(string storedName) => Stored.ContainsKey(storedName);

        public async Task<long> WriteAsync(string storedName, Stream content, long limit, CancellationToken ct)
        {
            if (TooBig) return -1;
            using var copy = new MemoryStream();
            await content.CopyToAsync(copy, ct);
            Stored[storedName] = copy.ToArray();
            return copy.Length;
        }

        public Stream? OpenRead(string storedName) => Stored.TryGetValue(storedName, out var bytes) ? new MemoryStream(bytes) : null;

        public void Delete(string storedName) => Stored.Remove(storedName);
    }
}
