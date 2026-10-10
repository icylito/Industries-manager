using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace api_v2.Migrations.State
{
    /// <inheritdoc />
    public partial class NamedBoardsSettingsTray : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_ScratchBoards_UserId",
                table: "ScratchBoards");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "OrphanedAt",
                table: "ScratchFiles",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Name",
                table: "ScratchBoards",
                type: "character varying(60)",
                maxLength: 60,
                nullable: false,
                defaultValue: "My board");

            migrationBuilder.AddColumn<bool>(
                name: "Pinned",
                table: "ScratchBoards",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "View",
                table: "ScratchBoards",
                type: "jsonb",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ScratchTrays",
                columns: table => new
                {
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    Items = table.Column<string>(type: "jsonb", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ScratchTrays", x => x.UserId);
                    table.ForeignKey(
                        name: "FK_ScratchTrays_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "UserSettings",
                columns: table => new
                {
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    Shortcuts = table.Column<string>(type: "jsonb", nullable: false),
                    Mouse = table.Column<string>(type: "jsonb", nullable: false),
                    Theme = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: true),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserSettings", x => x.UserId);
                    table.CheckConstraint("CK_UserSettings_Theme", "\"Theme\" IS NULL OR \"Theme\" IN ('light', 'dark')");
                    table.ForeignKey(
                        name: "FK_UserSettings_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ScratchBoards_UserId_UpdatedAt",
                table: "ScratchBoards",
                columns: new[] { "UserId", "UpdatedAt" });

            // Each person's one board becomes their first named board. Where they left it and their carry tray
            // move out of the document into their own places. The document itself is left as it was, so Down
            // gives back exactly what was there; the next save of the board drops the two old parts.
            migrationBuilder.Sql("""
                UPDATE "ScratchBoards" SET "View" = "Document"->'view'
                WHERE jsonb_typeof("Document"->'view') = 'object';
                """);
            migrationBuilder.Sql("""
                INSERT INTO "ScratchTrays" ("UserId", "Items", "UpdatedAt")
                SELECT "UserId", "Document"->'tray', "UpdatedAt" FROM "ScratchBoards"
                WHERE jsonb_typeof("Document"->'tray') = 'array' AND jsonb_array_length("Document"->'tray') > 0;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Back to one board each. The first board a person had is kept and the boards made since are lost,
            // along with names, pins, settings and the sweep's notes. Where they left the kept board and their
            // tray go back into its document, where the older page looks for them.
            migrationBuilder.Sql("""
                DELETE FROM "ScratchBoards" b
                WHERE EXISTS (SELECT 1 FROM "ScratchBoards" o WHERE o."UserId" = b."UserId" AND o."Id" < b."Id");
                """);
            migrationBuilder.Sql("""
                UPDATE "ScratchBoards" SET "Document" = jsonb_set("Document", '{view}', "View")
                WHERE "View" IS NOT NULL;
                """);
            migrationBuilder.Sql("""
                UPDATE "ScratchBoards" b SET "Document" = jsonb_set(b."Document", '{tray}', t."Items")
                FROM "ScratchTrays" t WHERE t."UserId" = b."UserId";
                """);

            migrationBuilder.DropTable(
                name: "ScratchTrays");

            migrationBuilder.DropTable(
                name: "UserSettings");

            migrationBuilder.DropIndex(
                name: "IX_ScratchBoards_UserId_UpdatedAt",
                table: "ScratchBoards");

            migrationBuilder.DropColumn(
                name: "OrphanedAt",
                table: "ScratchFiles");

            migrationBuilder.DropColumn(
                name: "Name",
                table: "ScratchBoards");

            migrationBuilder.DropColumn(
                name: "Pinned",
                table: "ScratchBoards");

            migrationBuilder.DropColumn(
                name: "View",
                table: "ScratchBoards");

            migrationBuilder.CreateIndex(
                name: "IX_ScratchBoards_UserId",
                table: "ScratchBoards",
                column: "UserId",
                unique: true);
        }
    }
}
