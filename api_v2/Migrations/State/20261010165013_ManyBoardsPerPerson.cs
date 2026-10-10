using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace api_v2.Migrations.State
{
    /// <inheritdoc />
    // A person keeps many boards. On a database that had named boards before the chains were split, the first
    // version of AdoptStateTables made the old one-board-per-person index again; this takes it away. Everywhere
    // else NamedBoardsSettingsTray already did, and this changes nothing.
    public partial class ManyBoardsPerPerson : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""DROP INDEX IF EXISTS "IX_ScratchBoards_UserId";""");
        }

        /// <inheritdoc />
        // Nothing: the index belongs to the layout before NamedBoardsSettingsTray, whose Down puts it back
        protected override void Down(MigrationBuilder migrationBuilder)
        {
        }
    }
}
