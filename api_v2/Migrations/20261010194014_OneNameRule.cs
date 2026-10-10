using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace api_v2.Migrations
{
    /// <inheritdoc />
    // One name rule for the data (Rules/Names.cs): two names are the same when they match ignoring capital letters,
    // accents, spaces, punctuation and symbols, by ICU, so "Acme, Inc." and "acme inc" can't both be originals.
    // Companies: a later company whose name is the same as an earlier original is flagged as a copy of it, the way an
    // import flags one, before the stricter unique index goes on, so going forward never stops on old names.
    // The Tables page: a later live table with the same name as an earlier one gets its number added to its name
    // ("Sales (12)", or "Sales (12-2)" if that is taken too), since a table can't be flagged.
    public partial class OneNameRule : Migration
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

            migrationBuilder.Sql("""
                UPDATE "Industries" AS later SET "DuplicateOf" = first."Id"
                FROM (SELECT min("Id") AS "Id", "Name" COLLATE name_rule AS name FROM "Industries"
                      WHERE "DuplicateOf" IS NULL AND ("Name" COLLATE name_rule) <> '' GROUP BY 2 HAVING count(*) > 1) AS first
                WHERE later."DuplicateOf" IS NULL AND later."Name" COLLATE name_rule = first.name AND later."Id" <> first."Id";

                DROP INDEX IF EXISTS "IX_Industries_Name_IgnoreCase";
                CREATE UNIQUE INDEX "IX_Industries_NameRule" ON "Industries" ("Name" COLLATE name_rule)
                    WHERE "DuplicateOf" IS NULL AND ("Name" COLLATE name_rule) <> '';
                """);

            // Each new name is tried against every live table until one is free, so the rename never makes a clash
            migrationBuilder.Sql("""
                DO $$
                DECLARE
                    t record;
                    candidate text;
                    n int;
                BEGIN
                    FOR t IN SELECT x."Id", x."Name" FROM "UserTables" AS x
                             WHERE x."DeletedAt" IS NULL AND EXISTS (
                                 SELECT 1 FROM "UserTables" AS o
                                 WHERE o."DeletedAt" IS NULL AND o."Id" < x."Id" AND o."Name" COLLATE name_rule = x."Name")
                             ORDER BY x."Id"
                    LOOP
                        n := 1;
                        LOOP
                            candidate := left(t."Name", 46) || ' (' || t."Id" || CASE WHEN n > 1 THEN '-' || n ELSE '' END || ')';
                            EXIT WHEN NOT EXISTS (SELECT 1 FROM "UserTables" AS o
                                                  WHERE o."DeletedAt" IS NULL AND o."Id" <> t."Id" AND o."Name" COLLATE name_rule = candidate);
                            n := n + 1;
                        END LOOP;
                        UPDATE "UserTables" SET "Name" = candidate WHERE "Id" = t."Id";
                    END LOOP;
                END $$;

                DROP INDEX IF EXISTS "IX_UserTables_Name_IgnoreCase";
                CREATE UNIQUE INDEX "IX_UserTables_NameRule" ON "UserTables" ("Name" COLLATE name_rule) WHERE "DeletedAt" IS NULL;
                """);
        }

        /// <inheritdoc />
        // Going back puts the older, looser indexes back (case and outer spaces only). Companies flagged and tables
        // renamed going forward stay as they are: the flags and names are data, and the older rule allows them.
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP INDEX IF EXISTS "IX_Industries_NameRule";
                CREATE UNIQUE INDEX "IX_Industries_Name_IgnoreCase" ON "Industries" (lower(btrim("Name"))) WHERE "DuplicateOf" IS NULL;
                DROP INDEX IF EXISTS "IX_UserTables_NameRule";
                CREATE UNIQUE INDEX "IX_UserTables_Name_IgnoreCase" ON "UserTables" (lower(btrim("Name"))) WHERE "DeletedAt" IS NULL;
                """);

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
