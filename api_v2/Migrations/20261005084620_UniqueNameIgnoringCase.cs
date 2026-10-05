using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace api_v2.Migrations
{
    /// <inheritdoc />
    public partial class UniqueNameIgnoringCase : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "DuplicateOf",
                table: "Industries",
                type: "integer",
                nullable: true);

            // EF can't describe an index on lower(btrim(name)), so it's plain SQL. Flagged import rows are skipped
            migrationBuilder.Sql(
                """CREATE UNIQUE INDEX "IX_Industries_Name_IgnoreCase" ON "Industries" (lower(btrim("Name"))) WHERE "DuplicateOf" IS NULL;""");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""DROP INDEX "IX_Industries_Name_IgnoreCase";""");

            migrationBuilder.DropColumn(
                name: "DuplicateOf",
                table: "Industries");
        }
    }
}
