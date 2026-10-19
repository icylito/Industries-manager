using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace api_v2.Migrations
{
    /// <inheritdoc />
    public partial class RenameIndustries : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropPrimaryKey(
                name: "PK_Indsutries",
                table: "Indsutries");

            migrationBuilder.RenameTable(
                name: "Indsutries",
                newName: "Industries");

            migrationBuilder.AddPrimaryKey(
                name: "PK_Industries",
                table: "Industries",
                column: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropPrimaryKey(
                name: "PK_Industries",
                table: "Industries");

            migrationBuilder.RenameTable(
                name: "Industries",
                newName: "Indsutries");

            migrationBuilder.AddPrimaryKey(
                name: "PK_Indsutries",
                table: "Indsutries",
                column: "Id");
        }
    }
}
