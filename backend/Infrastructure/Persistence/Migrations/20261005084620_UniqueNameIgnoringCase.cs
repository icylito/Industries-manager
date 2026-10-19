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

            // Two originals whose names differ only in case or outer spaces can't both stay originals: each later one
            // is flagged as a copy of the oldest, the way an import flags it, so going forward never stops on them
            migrationBuilder.Sql(
                """
                UPDATE "Industries" AS later SET "DuplicateOf" = first."Id"
                FROM (SELECT lower(btrim("Name")) AS key, min("Id") AS "Id" FROM "Industries" GROUP BY 1 HAVING count(*) > 1) AS first
                WHERE lower(btrim(later."Name")) = first.key AND later."Id" <> first."Id";
                """);

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
