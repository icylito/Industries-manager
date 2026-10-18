namespace api_v2.Application.Ports;

// The files uploaded to the Scratchpad, kept on disk outside the web root
public interface IScratchFiles
{
    void Delete(string storedName);
}
