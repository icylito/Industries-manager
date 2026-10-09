using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace api_v2.Migrations
{
    /// <inheritdoc />
    public partial class AddUserTablesAndManager : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Users_Role",
                table: "Users");

            migrationBuilder.CreateTable(
                name: "UserTables",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Name = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    Columns = table.Column<string>(type: "jsonb", nullable: false),
                    RowCount = table.Column<int>(type: "integer", nullable: false),
                    CreatedBy = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    DeletedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    Version = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserTables", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "UserTableRows",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TableId = table.Column<int>(type: "integer", nullable: false),
                    Data = table.Column<string>(type: "jsonb", nullable: false),
                    CreatedBy = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserTableRows", x => x.Id);
                    table.ForeignKey(
                        name: "FK_UserTableRows_UserTables_TableId",
                        column: x => x.TableId,
                        principalTable: "UserTables",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.AddCheckConstraint(
                name: "CK_Users_Role",
                table: "Users",
                sql: "\"Role\" IN ('admin', 'manager', 'normal')");

            migrationBuilder.CreateIndex(
                name: "IX_UserTableRows_TableId",
                table: "UserTableRows",
                column: "TableId");

            migrationBuilder.CreateIndex(
                name: "IX_UserTables_DeletedAt",
                table: "UserTables",
                column: "DeletedAt");

            // EF can't describe an index on lower(btrim(name)), so it's plain SQL, like the industries one.
            // Only live tables count, so a name in the bin can be used again.
            migrationBuilder.Sql(
                """CREATE UNIQUE INDEX "IX_UserTables_Name_IgnoreCase" ON "UserTables" (lower(btrim("Name"))) WHERE "DeletedAt" IS NULL;""");
        }

        /// <inheritdoc />
        // WARNING: going back past this migration deletes every table made on the Tables page, with all its rows,
        // and turns every manager into a normal account. To undo it without losing them, restore a backup instead.
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""DROP INDEX IF EXISTS "IX_UserTables_Name_IgnoreCase";""");

            migrationBuilder.DropTable(
                name: "UserTableRows");

            migrationBuilder.DropTable(
                name: "UserTables");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Users_Role",
                table: "Users");

            // The old rule only allows admin and normal, so managers have to become normal first or it fails
            migrationBuilder.Sql("""UPDATE "Users" SET "Role" = 'normal' WHERE "Role" = 'manager';""");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Users_Role",
                table: "Users",
                sql: "\"Role\" IN ('admin', 'normal')");
        }
    }
}
