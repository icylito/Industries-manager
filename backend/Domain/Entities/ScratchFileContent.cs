namespace api_v2.Domain.Entities;

// The bytes of one uploaded Scratchpad file, in their own table so reading or listing the file rows never drags
// up to 25 MB along. Deleting the file row takes its bytes with it.
public class ScratchFileContent
{
    public int ScratchFileId { get; set; }
    public required byte[] Bytes { get; set; }
}
