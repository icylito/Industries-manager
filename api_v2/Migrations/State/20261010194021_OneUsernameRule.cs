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
            // The one name rule (Rules/Names.cs, Names.Key) as a database function, so unique indexes can use it:
            // lowercase, accents taken apart and dropped, and everything that isn't a letter or a digit removed.
            // Both chains make it (CREATE OR REPLACE), whichever comes first.
            migrationBuilder.Sql("""
                CREATE OR REPLACE FUNCTION name_key(text) RETURNS text
                LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
                AS $$ SELECT regexp_replace(normalize(lower($1), NFKD), '[^[:alnum:]]', '', 'g') $$;
                """);

            migrationBuilder.AddColumn<bool>(
                name: "NameClash",
                table: "Users",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.Sql("""
                UPDATE "Users" AS u SET "NameClash" = true
                WHERE EXISTS (SELECT 1 FROM "Users" AS o WHERE o."Id" < u."Id" AND name_key(o."Username") = name_key(u."Username"));

                CREATE UNIQUE INDEX "IX_Users_NameKey" ON "Users" (name_key("Username")) WHERE NOT "NameClash";
                """);
        }

        /// <inheritdoc />
        // Going back loses the clash flags; usernames themselves are untouched
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""DROP INDEX IF EXISTS "IX_Users_NameKey";""");

            migrationBuilder.DropColumn(
                name: "NameClash",
                table: "Users");

            // The function goes only when no index of either chain still uses it
            migrationBuilder.Sql("""
                DO $$
                BEGIN
                    IF NOT EXISTS (SELECT 1 FROM pg_depend d JOIN pg_proc p ON p.oid = d.refobjid
                                   WHERE p.proname = 'name_key' AND d.classid = 'pg_class'::regclass) THEN
                        DROP FUNCTION IF EXISTS name_key(text);
                    END IF;
                END $$;
                """);
        }
    }
}
