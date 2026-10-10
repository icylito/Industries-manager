using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace api_v2.Migrations
{
    /// <inheritdoc />
    // One name rule for the data (Rules/Names.cs): two names are the same when they match after ignoring capital
    // letters, accents, spaces, punctuation and symbols, so "Acme, Inc." and "acme inc" can't both be originals.
    // Companies: a later company whose name is the same as an earlier original is flagged as a copy of it, the way an
    // import flags one, before the stricter unique index goes on, so going forward never stops on old names.
    // The Tables page: a later live table with the same name as an earlier one gets its number added to its name
    // ("Sales (12)"), since a table can't be flagged; nothing else about it changes.
    public partial class OneNameRule : Migration
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

            migrationBuilder.Sql("""
                UPDATE "Industries" AS later SET "DuplicateOf" = first."Id"
                FROM (SELECT name_key("Name") AS key, min("Id") AS "Id" FROM "Industries"
                      WHERE "DuplicateOf" IS NULL AND name_key("Name") <> '' GROUP BY 1 HAVING count(*) > 1) AS first
                WHERE later."DuplicateOf" IS NULL AND name_key(later."Name") = first.key AND later."Id" <> first."Id";

                DROP INDEX IF EXISTS "IX_Industries_Name_IgnoreCase";
                CREATE UNIQUE INDEX "IX_Industries_NameKey" ON "Industries" (name_key("Name"))
                    WHERE "DuplicateOf" IS NULL AND name_key("Name") <> '';
                """);

            migrationBuilder.Sql("""
                UPDATE "UserTables" AS t SET "Name" = left(t."Name", 50) || ' (' || t."Id" || ')'
                WHERE t."DeletedAt" IS NULL AND EXISTS (
                    SELECT 1 FROM "UserTables" AS o
                    WHERE o."DeletedAt" IS NULL AND o."Id" < t."Id" AND name_key(o."Name") = name_key(t."Name"));

                DROP INDEX IF EXISTS "IX_UserTables_Name_IgnoreCase";
                CREATE UNIQUE INDEX "IX_UserTables_NameKey" ON "UserTables" (name_key("Name")) WHERE "DeletedAt" IS NULL;
                """);
        }

        /// <inheritdoc />
        // Going back puts the older, looser indexes back (case and outer spaces only). Companies flagged and tables
        // renamed going forward stay as they are: the flags and names are data, and the older rule allows them.
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP INDEX IF EXISTS "IX_Industries_NameKey";
                CREATE UNIQUE INDEX "IX_Industries_Name_IgnoreCase" ON "Industries" (lower(btrim("Name"))) WHERE "DuplicateOf" IS NULL;
                DROP INDEX IF EXISTS "IX_UserTables_NameKey";
                CREATE UNIQUE INDEX "IX_UserTables_Name_IgnoreCase" ON "UserTables" (lower(btrim("Name"))) WHERE "DeletedAt" IS NULL;
                """);

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
