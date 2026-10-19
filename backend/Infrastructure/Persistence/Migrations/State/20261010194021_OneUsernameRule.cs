using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace api_v2.Migrations.State
{
    /// <inheritdoc />
    // One name rule for accounts too (Rules/Names.cs): "ali.k" and "ali_k" are one username. An account whose
    // username is the same as an older account's is flagged (NameClash) for an admin to rename or delete; nobody's
    // sign in changes. The unique index skips flagged accounts, so no new clash can be made.
    public partial class OneUsernameRule : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // The one name rule (Rules/Names.cs) as an ICU collation, so unique indexes and comparisons can use it: equal
            // ignoring case and accents (level1) and spaces, punctuation, symbols and currency signs (ka-shifted up to
            // kv-currency). Not deterministic, so two different strings can be one name. Both chains make it if it
            // isn't there yet, whichever comes first.
            migrationBuilder.Sql("""
                DO $$
                BEGIN
                    IF NOT EXISTS (SELECT 1 FROM pg_collation WHERE collname = 'name_rule') THEN
                        CREATE COLLATION name_rule (provider = icu, locale = 'und-u-ka-shifted-ks-level1-kv-currency', deterministic = false);
                    END IF;
                END $$;
                """);

            migrationBuilder.AddColumn<bool>(
                name: "NameClash",
                table: "Users",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.Sql("""
                UPDATE "Users" AS u SET "NameClash" = true
                WHERE EXISTS (SELECT 1 FROM "Users" AS o WHERE o."Id" < u."Id" AND o."Username" COLLATE name_rule = u."Username");

                CREATE UNIQUE INDEX "IX_Users_NameRule" ON "Users" ("Username" COLLATE name_rule) WHERE NOT "NameClash";
                """);
        }

        /// <inheritdoc />
        // Going back loses the clash flags; usernames themselves are untouched
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""DROP INDEX IF EXISTS "IX_Users_NameRule";""");

            migrationBuilder.DropColumn(
                name: "NameClash",
                table: "Users");

            // The collation goes only when no index of either chain still uses it
            migrationBuilder.Sql("""
                DO $$
                BEGIN
                    IF NOT EXISTS (SELECT 1 FROM pg_depend d JOIN pg_collation c ON c.oid = d.refobjid
                                   WHERE c.collname = 'name_rule' AND d.classid = 'pg_class'::regclass) THEN
                        DROP COLLATION IF EXISTS name_rule;
                    END IF;
                END $$;
                """);
        }
    }
}
