# Every data migration, down and up: the throwaway database walks back one migration at a time to the oldest layout,
# then forward one at a time to the newest, then the same again in one jump each way. At every step:
#   the migration list is right, every table the migration doesn't name keeps every row exactly (a count and an
#   md5), what the tables it does name lose going back is listed, and on the way up each layout is exactly the one
#   seen at that step on the way down.
# Fields are played with on the way: a company with no release date and one with a price go down with the board,
# the price is changed and a company is added in the oldest layout, and the newest layout must still have them.
# Then two names that differ only in case are put in just before the migration that forbids them: going forward
# flags the later one as a copy instead of stopping.
#   python3 -I check_migration_walk.py                  down to the oldest migration and back
#   set FLOOR=AddUsersAndSessions & python3 -I ...      down to that one instead
# Only the data travels in time: at every step the tables that are always current (accounts, notes, the Scratchpad,
# requests, settings, see backend/Infrastructure/Persistence/StateModel.cs) must keep every row. And a new database built by both migration
# chains must come out exactly like the one that was upgraded.
# Stop the throwaway API first. A dump of both throwaway databases is taken before anything moves and loaded back
# at the end (KEEP=1 leaves the database as the walk left it), because going back past a table drops its rows.
import os, re, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pg, t

check = pg.Checks()
names = pg.migrations()
top = names[-1]
wanted = os.environ.get("FLOOR") or names[0]
floors = [n for n in names if wanted in (n, pg.short(n))]
if not floors: sys.exit(f"There's no migration called {wanted}")
floor = floors[0]
low, high = names.index(floor), len(names) - 1

pg.nobody_connected(t.MAIN_DB, t.COLLECTOR_DB)
if pg.applied() != names:
    sys.exit(f"{t.MAIN_DB} isn't at the newest migration with every one before it. Start the throwaway API once, stop it, run again")
print(f"Walking {t.MAIN_DB} from {pg.short(top)} down to {pg.short(floor)} ({high - low} steps) and back")
print("building the API (Release)")
pg.build()

safe = os.path.join(t.BACKUPS, "dumps", "walk-" + time.strftime("%Y-%m-%d_%H%M%S"))
os.makedirs(safe, exist_ok=True)
pg.dump(t.MAIN_DB, os.path.join(safe, "main.dump"))
pg.dump(t.COLLECTOR_DB, os.path.join(safe, "collector.dump"))
print(f"  both databases dumped to {safe} first")
original = pg.snapshot()

def step(to):
    return step_on(to, t.MAIN_DB, "data")

def step_on(to, db, chain):
    try:
        return pg.update(to, db, chain), None
    except RuntimeError as e:
        return None, str(e)

def touched(migration, *layouts):
    # The tables a migration names, in its builder calls or its plain SQL, out of the tables either side has
    text = open(os.path.join(pg.MIGRATIONS, "Migrations", migration + ".cs"), encoding="utf-8").read()
    known = set().union(*(pg.tables_in(l) for l in layouts))
    return {n for n in re.findall(r'"(\w+)"', text) if n in known}

def industries():
    # The companies table is "Indsutries" in the oldest layout, renamed in the second
    return "Industries" if "Industries" in pg.tables_in(pg.layout()) else "Indsutries"

def company(name, column):
    return pg.sql(t.MAIN_DB, f"""SELECT coalesce("{column}"::text, 'null') FROM "{industries()}" WHERE "Name" = '{name}'""")

def table_of(key):
    return key.rsplit(".", 1)[-1].strip('"')

# The tables the state chain owns, from backend/Infrastructure/Persistence/StateModel.cs
STATE_TABLES = {"Users", "Sessions", "UserNotes", "UserSettings", "ScratchBoards", "ScratchFiles", "ScratchTrays", "Requests", "Settings"}

def state_kept(before, after):
    moved = {k: v for k, v in pg.changed(before, after).items() if table_of(k) in STATE_TABLES}
    check("    accounts, notes, the Scratchpad, requests and settings keep every row", not moved, moved)

def untouched_same(before, after, names_touched, what):
    moved = {k: v for k, v in pg.changed(before, after, before.keys()).items() if table_of(k) not in names_touched}
    check(what, not moved, moved)

def losses(before, after, names_touched):
    out = []
    for k in sorted(set(before) | set(after)):
        if table_of(k) not in names_touched: continue
        b, a = before.get(k), after.get(k)
        if b == a: continue
        bn, an = (int(b.split()[0]) if b else None), (int(a.split()[0]) if a else None)
        if an is None: out.append(f"{table_of(k)} dropped with its {bn} rows")
        elif bn is None: out.append(f"{table_of(k)} made ({an} rows)")
        elif an != bn: out.append(f"{table_of(k)} {bn} -> {an} rows")
        else: out.append(f"{table_of(k)} rewritten, {an} rows")
    return out

# ---- fields set up in the newest layout ----
print("\nfields set up at the newest layout")
cols = pg.sql(t.MAIN_DB, """SELECT string_agg(quote_ident(column_name), ',') FROM information_schema.columns
                            WHERE table_name = 'Industries' AND column_name NOT IN ('Id', 'Name', 'Release', 'Price')""")
for name, release, price in (("Walk no release", "NULL", "4.25"), ("Walk priced", "DATE '2026-01-02'", "99.99")):
    pg.sql(t.MAIN_DB, f"""INSERT INTO "Industries" ({cols}, "Name", "Release", "Price")
                          SELECT {cols}, '{name}', {release}, {price} FROM "Industries" WHERE "DuplicateOf" IS NULL LIMIT 1""")
print("  'Walk no release' with no release date, 'Walk priced' at 99.99")
pictures = {top: pg.snapshot()}

# ---- down, one migration at a time ----
print("\ndown, one step at a time")
reached = high
for i in range(high, low, -1):
    migration, to = names[i], names[i - 1]
    took, failed = step(to)
    if failed:
        check(f"{pg.short(migration)} goes back", False, failed.splitlines()[-1])
        break
    picture = pg.snapshot()
    named = touched(migration, pictures[migration]["layout"], picture["layout"])
    print(f"  {pg.short(migration)} back in {took:.1f}s")
    check(f"    the list ends at {pg.short(to)}", picture["applied"] == names[:i], picture["applied"][-2:])
    untouched_same(pictures[migration]["rows"], picture["rows"], named, "    every table it doesn't name keeps every row")
    state_kept(pictures[migration]["rows"], picture["rows"])
    for line in losses(pictures[migration]["rows"], picture["rows"], named): print("    " + line)
    pictures[to] = picture
    reached = i - 1

at_floor = names[reached]
print(f"\nat {pg.short(at_floor)}")
check("'Walk priced' still costs 99.99", company("Walk priced", "Price") == "99.99", company("Walk priced", "Price"))
release_needed = names.index("20260930120356_MadeReleaseOptional") > reached
if release_needed:
    # Going back leaves the release date optional: an empty date stays empty, nothing is filled in
    check("'Walk no release' still has no release date", company("Walk no release", "Release") == "null", company("Walk no release", "Release"))
# Played with in the old layout: a price changed, a company added the way the old page would have
table = industries()
pg.sql(t.MAIN_DB, f"""UPDATE "{table}" SET "Price" = 123.45 WHERE "Name" = 'Walk priced'""")
pg.sql(t.MAIN_DB, f"""INSERT INTO "{table}" ("Name", "Sector", "Price", "Release") VALUES ('Walk old row', 'Old sector', 7.5, DATE '2026-03-04')""")
print(f"  in the old layout ({table}): 'Walk priced' set to 123.45, 'Walk old row' added")
pictures[at_floor] = pg.snapshot()

# ---- up, one migration at a time ----
print("\nup, one step at a time")
for i in range(reached + 1, high + 1):
    migration = names[i]
    before = pg.snapshot()
    took, failed = step(migration)
    if failed:
        check(f"{pg.short(migration)} goes forward", False, failed.splitlines()[-1])
        sys.exit("stopped: the walk can't reach the newest layout. The dump to load back is in " + safe)
    picture = pg.snapshot()
    named = touched(migration, before["layout"], picture["layout"])
    print(f"  {pg.short(migration)} forward in {took:.1f}s")
    check(f"    the list ends at {pg.short(migration)}", picture["applied"] == names[:i + 1], picture["applied"][-2:])
    if migration in pictures:
        check("    the layout is exactly the one this step had on the way down", picture["layout"] == pictures[migration]["layout"],
              pg.layout_diff(pictures[migration]["layout"], picture["layout"]))
    untouched_same(before["rows"], picture["rows"], named, "    every table it doesn't name keeps every row")
    state_kept(before["rows"], picture["rows"])

print(f"\nback at {pg.short(top)}")
check("'Walk priced' keeps the price set in the old layout", company("Walk priced", "Price") == "123.45", company("Walk priced", "Price"))
check("'Walk old row' made in the old layout is here with its fields",
      [company("Walk old row", c) for c in ("Sector", "Price", "Release")] == ["Old sector", "7.5", "2026-03-04"],
      [company("Walk old row", c) for c in ("Sector", "Price", "Release")])
if release_needed:
    check("'Walk no release' has no release date again", company("Walk no release", "Release") == "null", company("Walk no release", "Release"))
print("  'Walk old row' as the newest layout has it: " + pg.sql(t.MAIN_DB, """SELECT row_to_json(i)::text FROM "Industries" i WHERE "Name" = 'Walk old row'"""))
lost = losses(original["rows"], pg.snapshot()["rows"], {table_of(k) for k in original["rows"]})
print("  against the start, these tables differ (the rows Down dropped don't come back up):")
for line in lost: print("    " + line)

# ---- the same in one jump each way ----
print("\nin one jump each way")
took, failed = step(at_floor)
check(f"down to {pg.short(at_floor)} in one go ({took or 0:.1f}s)", not failed, failed)
check("  the same layout as stepping down", pg.layout() == pictures[at_floor]["layout"], pg.layout_diff(pictures[at_floor]["layout"], pg.layout()))
took, failed = step(top)
check(f"up to {pg.short(top)} in one go ({took or 0:.1f}s)", not failed, failed)
check("  the same layout as stepping up", pg.layout() == pictures[top]["layout"], pg.layout_diff(pictures[top]["layout"], pg.layout()))

# ---- two names that differ only in case, put in before the migration that forbids them ----
unique = "20261005084620_UniqueNameIgnoringCase"
if names.index(unique) > reached:
    print("\ntwo names that differ only in case")
    before_unique = names[names.index(unique) - 1]
    step(before_unique)
    table = industries()
    pg.sql(t.MAIN_DB, f"""INSERT INTO "{table}" ("Name", "Sector", "Price", "Release") VALUES ('Walk Twin', 'A', 1, NULL), ('walk twin ', 'B', 2, NULL)""")
    took, failed = step(unique)
    check(f"{pg.short(unique)} goes forward over 'Walk Twin' and 'walk twin '", not failed, failed)
    first, later = company("Walk Twin", "Id"), company("walk twin ", "DuplicateOf")
    check("  the later one is flagged as a copy of the first, the first stays an original",
          later == first and company("Walk Twin", "DuplicateOf") == "null", (first, later))
    took, failed = step(top)
    check(f"and on up to {pg.short(top)}", not failed, failed)

# ---- a new database built by both chains looks exactly like the upgraded one ----
print("\na new database built by both chains")
fresh = t.MAIN_DB + "_fresh"
pg.drop(fresh)
pg.sql("postgres", f'CREATE DATABASE "{fresh}"')
took_data, failed = step_on(top, fresh, "data")
check(f"the data chain builds it ({took_data or 0:.1f}s)", not failed, failed)
took_state, failed = step_on(pg.migrations("state")[-1], fresh, "state")
check(f"then the state chain ({took_state or 0:.1f}s)", not failed, failed)
check("its layout is exactly the upgraded database's", pg.layout(fresh) == pg.layout(),
      pg.layout_diff(pg.layout(), pg.layout(fresh)))
pg.drop(fresh)

# ---- put back ----
if os.environ.get("KEEP") != "1":
    pg.restore(os.path.join(safe, "main.dump"), t.MAIN_DB)
    pg.restore(os.path.join(safe, "collector.dump"), t.COLLECTOR_DB)
    after = pg.snapshot()
    print()
    check(f"the throwaway databases are loaded back from the dump, every row as at the start",
          after["rows"] == original["rows"] and after["applied"] == original["applied"], pg.changed(original["rows"], after["rows"]))

print("\n" + (f"{len(check.fails)} failed" if check.fails else "WALK OK"))
sys.exit(1 if check.fails else 0)
