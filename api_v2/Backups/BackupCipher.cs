using System.Buffers.Binary;
using System.Security.Cryptography;

namespace api_v2.Backups;

// Encrypts a backup file with AES-256-GCM in chunks, so a big dump never has to fit in memory. The layout:
//   "SLBAK1\n" (7 bytes), a random 4 byte nonce prefix, then chunks of up to 1 MiB, each one as
//   a flag (1 for the last chunk, else 0), the plaintext length (4 bytes, big endian), the ciphertext and a 16 byte tag.
// A chunk's nonce is the prefix plus its number, and its number and flag are authenticated. So a chunk can't be
// moved, dropped, or the file cut short, without decryption failing.
public static class BackupCipher
{
    private static readonly byte[] Magic = "SLBAK1\n"u8.ToArray();
    private const int ChunkSize = 1 << 20;
    private const int TagSize = 16;
    private const int PrefixSize = 4;
    private const int NonceSize = 12;
    private const int ChunkHeaderSize = 5;

    public const string CantOpenMessage = "That backup can't be opened on this computer. It was made on another one, or it's damaged";

    public static async Task<bool> IsSealedAsync(string path, CancellationToken ct)
    {
        await using var stream = File.OpenRead(path);
        var head = new byte[Magic.Length];
        try
        {
            await stream.ReadExactlyAsync(head, ct);
        }
        catch (EndOfStreamException)
        {
            return false;
        }
        return head.AsSpan().SequenceEqual(Magic);
    }

    // Swaps the file for its sealed copy. A failure part way leaves the original as it was.
    public static async Task SealFileAsync(string path, byte[] key, CancellationToken ct)
    {
        var temp = path + ".sealing";
        try
        {
            await using (var input = File.OpenRead(path))
            await using (var output = new FileStream(temp, FileMode.Create, FileAccess.Write, FileShare.None))
            {
                await SealAsync(input, output, key, ct);
            }
            File.Move(temp, path, overwrite: true);
        }
        finally
        {
            // Gone already after a move, and a failed seal leaves no partial copy behind
            File.Delete(temp);
        }
    }

    // Reads a sealed file as plain bytes, one chunk at a time. A file that isn't sealed, or that a different key sealed, throws.
    public static async Task<Stream> OpenReadAsync(string path, byte[] key, CancellationToken ct)
    {
        var input = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        try
        {
            var head = new byte[Magic.Length + PrefixSize];
            await input.ReadExactlyAsync(head, ct);
            if (!head.AsSpan(0, Magic.Length).SequenceEqual(Magic)) throw new CryptographicException(CantOpenMessage);
            return new OpenedStream(input, key, head.AsSpan(Magic.Length, PrefixSize).ToArray());
        }
        catch
        {
            await input.DisposeAsync();
            throw;
        }
    }

    public static async Task SealAsync(Stream input, Stream output, byte[] key, CancellationToken ct)
    {
        using var aes = new AesGcm(key, TagSize);
        var prefix = RandomNumberGenerator.GetBytes(PrefixSize);
        await output.WriteAsync(Magic, ct);
        await output.WriteAsync(prefix, ct);

        var plain = new byte[ChunkSize];
        var cipher = new byte[ChunkSize];
        var tag = new byte[TagSize];
        var header = new byte[ChunkHeaderSize];
        for (ulong number = 0; ; number++)
        {
            var length = await FillAsync(input, plain, ct);
            // A short read means the input ended, so this is the last chunk. A file that is an exact multiple of the
            // chunk size gets an empty last chunk, which is how the reader knows it has everything.
            var last = length < ChunkSize;
            aes.Encrypt(Nonce(prefix, number), plain.AsSpan(0, length), cipher.AsSpan(0, length), tag, Aad(number, last));

            header[0] = last ? (byte)1 : (byte)0;
            BinaryPrimitives.WriteUInt32BigEndian(header.AsSpan(1), (uint)length);
            await output.WriteAsync(header, ct);
            await output.WriteAsync(cipher.AsMemory(0, length), ct);
            await output.WriteAsync(tag, ct);
            if (last) break;
        }
    }

    private static async Task<int> FillAsync(Stream input, byte[] buffer, CancellationToken ct)
    {
        var total = 0;
        while (total < buffer.Length)
        {
            var read = await input.ReadAsync(buffer.AsMemory(total), ct);
            if (read == 0) break;
            total += read;
        }
        return total;
    }

    private static byte[] Nonce(byte[] prefix, ulong number)
    {
        var nonce = new byte[NonceSize];
        prefix.CopyTo(nonce, 0);
        BinaryPrimitives.WriteUInt64BigEndian(nonce.AsSpan(PrefixSize), number);
        return nonce;
    }

    private static byte[] Aad(ulong number, bool last)
    {
        var aad = new byte[9];
        BinaryPrimitives.WriteUInt64BigEndian(aad, number);
        aad[8] = last ? (byte)1 : (byte)0;
        return aad;
    }

    // The plain contents of a sealed file, decrypted as it is read. Read only.
    private sealed class OpenedStream(FileStream input, byte[] key, byte[] prefix) : Stream
    {
        private readonly AesGcm _aes = new(key, TagSize);
        private readonly byte[] _plain = new byte[ChunkSize];
        private readonly byte[] _cipher = new byte[ChunkSize];
        private readonly byte[] _tag = new byte[TagSize];
        private readonly byte[] _header = new byte[ChunkHeaderSize];
        private ulong _number;
        private int _length;
        private int _offset;
        private bool _finished;

        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position
        {
            get => throw new NotSupportedException();
            set => throw new NotSupportedException();
        }

        public override void Flush() { }
        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException("Read asynchronously");
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken ct = default)
        {
            if (_offset >= _length)
            {
                if (_finished) return 0;
                await NextChunkAsync(ct);
                if (_length == 0) return 0;
            }
            var count = Math.Min(buffer.Length, _length - _offset);
            _plain.AsMemory(_offset, count).CopyTo(buffer);
            _offset += count;
            return count;
        }

        public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken ct) =>
            ReadAsync(buffer.AsMemory(offset, count), ct).AsTask();

        private async Task NextChunkAsync(CancellationToken ct)
        {
            try
            {
                await ReadChunkAsync(ct);
            }
            catch (EndOfStreamException)
            {
                // Cut short, so the last chunk never came
                throw new CryptographicException(CantOpenMessage);
            }
        }

        private async Task ReadChunkAsync(CancellationToken ct)
        {
            await input.ReadExactlyAsync(_header, ct).ConfigureAwait(false);
            var last = _header[0] switch
            {
                0 => false,
                1 => true,
                _ => throw new CryptographicException(CantOpenMessage)
            };
            var length = BinaryPrimitives.ReadUInt32BigEndian(_header.AsSpan(1));
            // Every chunk but the last is full, so a short one in the middle means the file was cut or spliced
            if (length > ChunkSize || (!last && length != ChunkSize)) throw new CryptographicException(CantOpenMessage);

            await input.ReadExactlyAsync(_cipher.AsMemory(0, (int)length), ct).ConfigureAwait(false);
            await input.ReadExactlyAsync(_tag, ct).ConfigureAwait(false);
            _aes.Decrypt(Nonce(prefix, _number), _cipher.AsSpan(0, (int)length), _tag, _plain.AsSpan(0, (int)length), Aad(_number, last));

            if (last && await input.ReadAsync(new byte[1], ct).ConfigureAwait(false) != 0)
            {
                throw new CryptographicException(CantOpenMessage);
            }
            _number++;
            _length = (int)length;
            _offset = 0;
            _finished = last;
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                _aes.Dispose();
                input.Dispose();
            }
            base.Dispose(disposing);
        }
    }
}
