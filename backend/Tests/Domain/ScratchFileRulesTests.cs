using api_v2.Domain.Scratchpad;
using Xunit;

namespace api_v2.Tests.Domain;

public sealed class ScratchFileRulesTests
{
    [Theory]
    [InlineData("report.docx", "Word, PowerPoint and Excel files can't go on the board (report.docx).")]
    [InlineData("notes.TXT", "Text files can't go on the board (notes.TXT). Copy the text and paste it instead.")]
    [InlineData("run.ps1", "That kind of file can't go on the board (run.ps1).")]
    [InlineData("photo.png", null)]
    [InlineData("plan.pdf", null)]
    public void Refused_kinds_are_named_by_their_extension(string file, string? expected) =>
        Assert.Equal(expected, ScratchFileRules.Refusal(file));

    [Fact]
    public void A_path_from_the_client_never_becomes_the_name()
    {
        Assert.Equal("evil.png", ScratchFileRules.DisplayName(Path.Combine("..", "..", "evil.png")));
        Assert.Equal("File", ScratchFileRules.DisplayName("   "));
    }

    [Fact]
    public void The_stored_name_is_a_guid_with_a_safe_extension()
    {
        var name = ScratchFileRules.StoredNameFor(".p/n\\g");
        Assert.Matches("^[0-9a-f]{32}\\.png$", name);
        Assert.Matches("^[0-9a-f]{32}$", ScratchFileRules.StoredNameFor(""));
    }

    [Theory]
    [InlineData("image/png", true)]
    [InlineData("application/pdf; charset=binary", true)]
    [InlineData("image/svg+xml", false)]
    [InlineData("text/html", false)]
    public void Only_pictures_and_pdf_open_in_place(string contentType, bool inline) =>
        Assert.Equal(inline, ScratchFileRules.ShowsInline(contentType));
}
