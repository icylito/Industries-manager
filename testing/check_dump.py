# A backup is only as good as what comes back from it. This dumps both throwaway databases (or takes the dumps of a
# backup the app made), loads them into two fresh databases, and compares: every table and every row (a count and
# an md5 per table), the layout, the migration list, and where every id counter stands. Then the Scratchpad's files:
# the bytes live on disk, not in the database, so each file row is checked for its file and each file for its row.
#   python3 -I check_dump.py                         dump the throwaway databases now and check the copies
#   python3 -I check_dump.py <backup folder>         check a backup the app made (main.dump and collector.dump)
# Stop the throwaway API first, so nothing changes between the dump and the comparison. Throwaway only.
# The copies are throwaway_main_copy and throwaway_collector_copy, dropped at the end (KEEP_COPY=1 keeps them).
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pg, t

check = pg.Checks()
MAIN_COPY, COLLECTOR_COPY = t.MAIN_DB + "_copy", t.COLLECTOR_DB + "_copy"
FILES = os.environ.get("SCRATCHPAD_FILES", os.path.join(t.BACKUPS, "scratchpad-files"))

pg.nobody_connected(t.MAIN_DB, t.COLLECTOR_DB)

given = sys.argv[1] if len(sys.argv) > 1 else None
if given:
    folder = os.path.abspath(given)
    print(f"Checking the backup in {folder}")
else:
    folder = os.path.join(t.BACKUPS, "dumps", time.strftime("%Y-%m-%d_%H%M%S"))
    os.makedirs(folder, exist_ok=True)
    print(f"Dumping {t.MAIN_DB} and {t.COLLECTOR_DB} to {folder}")
    for db, name in ((t.MAIN_DB, "main.dump"), (t.COLLECTOR_DB, "collector.dump")):
        started = time.time()
        size = pg.dump(db, os.path.join(folder, name))
        print(f"  {name}: {size / 1024:.0f} KB in {time.time() - started:.1f}s")

print("\nwhat the live databases hold")
live = pg.snapshot()
live_counters = {"main": pg.sequences(t.MAIN_DB), "collector": pg.sequences(t.COLLECTOR_DB)}
print(f"  {len(live['rows'])} tables, {sum(pg.counts(live['rows']).values())} rows, at {pg.short(live['applied'][-1])}")

print("\nthe dumps list every table")
for role in ("main", "collector"):
    in_dump = set(pg.dump_tables(os.path.join(folder, role + ".dump")))
    # A table with no rows has no data entry in some dumps, so only tables with rows must be listed
    with_rows = {k.split(".", 2)[2].strip('"') for k, n in pg.counts(live["rows"]).items() if k.startswith(role + ".") and n}
    missing = sorted(with_rows - {name.strip('"') for name in in_dump})
    check(f"{role}.dump has the rows of every table that has rows ({len(with_rows)})", not missing, missing)

print("\nloaded into fresh databases")
for role, copy in (("main", MAIN_COPY), ("collector", COLLECTOR_COPY)):
    started = time.time()
    pg.restore(os.path.join(folder, role + ".dump"), copy)
    print(f"  {role}.dump -> {copy} in {time.time() - started:.1f}s")
back = pg.snapshot(MAIN_COPY, COLLECTOR_COPY)
back_counters = {"main": pg.sequences(MAIN_COPY), "collector": pg.sequences(COLLECTOR_COPY)}

print("\ncompared")
check("the migration list is the same", back["applied"] == live["applied"], (live["applied"][-2:], back["applied"][-2:]))
# A CHECK that Postgres writes back in its own words after loading counts as the same (pg.same_meaning)
check("the layout is the same", back["layout"] == live["layout"], pg.layout_diff(live["layout"], back["layout"]))
check("every table is there", set(back["rows"]) == set(live["rows"]), sorted(set(live["rows"]) ^ set(back["rows"])))
differ = pg.changed(live["rows"], back["rows"])
check("every row in every table is the same (count and md5)", not differ, differ)
check("every id counter is where it was, so new rows never reuse an id", back_counters == live_counters,
      {k: (live_counters[k], back_counters[k]) for k in live_counters if live_counters[k] != back_counters[k]})
for key, value in sorted(back["rows"].items()):
    print(f"    {key:55} {value.split()[0]:>7} rows")

print("\nthe Scratchpad's files")
rows = [line.split("|") for line in pg.sql(MAIN_COPY, 'SELECT "Id" || \'|\' || "StoredName" || \'|\' || "SizeBytes" FROM "ScratchFiles" ORDER BY 1').splitlines() if line]
on_disk = set(os.listdir(FILES)) if os.path.isdir(FILES) else set()
missing = [(i, name) for i, name, _ in rows if name not in on_disk]
wrong_size = [(i, name) for i, name, size in rows if name in on_disk and os.path.getsize(os.path.join(FILES, name)) != int(size)]
stray = sorted(on_disk - {name for _, name, _ in rows})
print(f"  {len(rows)} file rows in the dump, {len(on_disk)} files in {FILES}")
check("every file row has its file on disk", not missing, missing[:10])
check("and every file is the size its row says", not wrong_size, wrong_size[:10])
if stray:
    print(f"  note: {len(stray)} file(s) on disk have no row (the sweep deleted the row first, or an upload never finished): {stray[:5]}")
print("  note: the dump holds the file rows only. The bytes are in the folder above, which a database dump never carries.")

if os.environ.get("KEEP_COPY") != "1":
    pg.drop(MAIN_COPY)
    pg.drop(COLLECTOR_COPY)
    print(f"\n{MAIN_COPY} and {COLLECTOR_COPY} dropped")

print("\n" + (f"{len(check.fails)} failed" if check.fails else "DUMP OK"))
sys.exit(1 if check.fails else 0)
