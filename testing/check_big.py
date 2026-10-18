import sys, os, time, subprocess
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import t
from t import call
t.TOK, _ = t.login("admin", t.ADMIN_PASSWORD)
def sql(q): return t.psql(t.MAIN_DB, q)

N = int(sys.argv[1]) if len(sys.argv) > 1 else 100000
# a big table straight in the database, same shape as the page makes
sql(f"""INSERT INTO "Industries" ("Name","Sector","Price","Release","Extra")
        SELECT 'Big Co ' || g, CASE WHEN g % 2 = 0 THEN 'Public Sector' ELSE 'Private Sector' END, (g % 1000) / 100.0, DATE '2020-01-01' + (g % 3000), ('{{"ticker":"T' || g || '"}}')::jsonb
        FROM generate_series(1, {N}) g""")
print("rows in table", sql('SELECT count(*) FROM "Industries"'))

# a saved version of the big table (a rules note saves a copy first)
s, schema = call("GET", "/schema"); assert s == 200
t0 = time.time(); s, b = call("PUT", "/schema", {"note": "big table copy", "fields": schema["fields"], "basedOn": schema["version"]}); assert s == 200, b
print(f"copy to history of {N} rows: {time.time()-t0:.1f}s")
s, versions = call("GET", "/history/versions"); big = versions[0]; print("version", big["id"], big["rowCount"], "rows")

# change the table so the restore has work to do, then restore the big version
sql('DELETE FROM "Industries" WHERE "Id" % 3 = 0')
t0 = time.time(); s, res = call("POST", f"/history/versions/{big['id']}/restore", {"note": "restoring every row to check the count"}); dt = time.time()-t0
print(f"restore of {N} rows from history: {s} {dt:.1f}s", res if s != 200 else res["restored"]); assert s == 200
assert int(sql('SELECT count(*) FROM "Industries"')) == big["rowCount"]

# bring back rows (import) of a 20k version, every row similar to one in the table
small = versions[-1] if len(versions) > 1 else big
sql(f"""DELETE FROM "Industries" WHERE "Id" > (SELECT min("Id") FROM "Industries") + 19999""")
s, schema = call("GET", "/schema"); s, b = call("PUT", "/schema", {"note": "20k copy", "fields": schema["fields"], "basedOn": schema["version"]}); assert s == 200, b
s, versions = call("GET", "/history/versions"); v20 = versions[0]; print("20k version", v20["id"], v20["rowCount"])
t0 = time.time(); s, res = call("POST", f"/history/versions/{v20['id']}/import", {"confirm": True, "skipDuplicates": False}); dt = time.time()-t0
print(f"bring back {v20['rowCount']} rows: {s} {dt:.1f}s", res if s != 200 else (res["imported"], "imported,", res["similar"], "similar")); assert s == 200
# the imported rows point at the row they copy
print("flagged copies", sql('SELECT count(*) FROM "Industries" WHERE "DuplicateOf" IS NOT NULL'), "log rows", t.psql(t.COLLECTOR_DB, "SELECT count(*) FROM row_changes WHERE action='import'", check=False))

# back up and restore the big backup through the new button too
s, bk = call("POST", "/backups", {}); assert s == 200, bk; print("backup rows", bk["rowCount"])
sql('DELETE FROM "Industries" WHERE "Id" % 2 = 0')
t0 = time.time(); s, res = call("POST", f"/backups/{bk['id']}/restore", {"confirm": "RESTORE"}); dt = time.time()-t0
print(f"restore backup of {bk['rowCount']} rows: {s} {dt:.1f}s", res if s != 200 else res["rows"]); assert s == 200
# clean up so the small checks keep working
sql("""DELETE FROM "Industries" WHERE "Name" LIKE 'Big Co %'""")
print("BIG OK, rows left", sql('SELECT count(*) FROM "Industries"'))
