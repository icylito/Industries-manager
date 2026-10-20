using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace api_v2.Migrations.State
{
    /// <inheritdoc />
    public partial class ScratchFileContents : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ScratchFileContents",
                columns: table => new
                {
                    ScratchFileId = table.Column<int>(type: "integer", nullable: false),
                    Bytes = table.Column<byte[]>(type: "bytea", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ScratchFileContents", x => x.ScratchFileId);
                    table.ForeignKey(
                        name: "FK_ScratchFileContents_ScratchFiles_ScratchFileId",
                        column: x => x.ScratchFileId,
                        principalTable: "ScratchFiles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ScratchFileContents");
        }
    }
}
