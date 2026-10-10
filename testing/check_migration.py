# A migration goes forward, back and forward again on the throwaway database, and each step is checked:
#   the migration list is right, going back leaves the layout exactly as it was, every row that was there before is
#   untouched, the only losses are the ones the migration's Down says it loses, and going forward again lands exactly
#   where the first forward did. Each step is timed.
#   python3 -I check_migration.py                       the newest migration
#   set MIGRATION=AddScratchFiles & python3 -I check_migration.py      any other one, by its name
# Stop the throwaway API first: it applies migrations when it starts and writes while the check compares.
# Throwaway only, like the other checks. Both throwaway databases are dumped first and loaded back at the end, since
# going back loses what the Down names (KEEP=1 leaves the database at the migration it checked instead).
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pg, t
from pg import API, changed, layout_diff, sql, applied, snapshot

check = pg.Checks()
fails = check.fails

def update(to):
    try:
        return pg.update(to)
    except RuntimeError as e:
        sys.exit(str(e))

# What a migration's Down is allowed to lose, set up after going forward and looked at after going back.
# A migration without an entry here must come back with nothing lost at all.
def user_tables_forward():
    normal = sql(t.MAIN_DB, """SELECT "Id" FROM "Users" WHERE "Role" = 'normal' ORDER BY "Id" LIMIT 1""")
    if normal:
        sql(t.MAIN_DB, f"""UPDATE "Users" SET "Role" = 'manager' WHERE "Id" = {normal}""")
    table = sql(t.MAIN_DB, """INSERT INTO "UserTables" ("Name", "Columns", "RowCount", "CreatedBy", "CreatedAt", "UpdatedAt", "Version")
                              VALUES ('Migration check', '[]', 1, 'check', now(), now(), 1) RETURNING "Id" """).splitlines()[0]
    sql(t.MAIN_DB, f"""INSERT INTO "UserTableRows" ("TableId", "Data", "CreatedBy", "CreatedAt", "UpdatedAt")
                       VALUES ({table}, '{{}}', 'check', now(), now())""")
    return normal

def user_tables_back(normal):
    if not normal:
        print("  (no normal account in the throwaway database, so the manager going back to normal wasn't tried. check_tables.py makes one)")
        return
    role = sql(t.MAIN_DB, f"""SELECT "Role" FROM "Users" WHERE "Id" = {normal}""")
    check("the manager made after going forward is a normal account again", role == "normal", role)

# Named boards: Down keeps each person's first board and loses the boards made since, names, pins and settings.
# Run with EXPECT_CHANGED=ScratchBoards,ScratchFiles, since every board and file row gains new columns going forward.
# Before going forward, the first board is given a view and a tray inside its document, the way the older page kept
# them, so going forward can be seen moving them out. Its own document is put back as it was at the very end.
OLD_PARTS = {"view": {"x": 12, "y": 34, "zoom": 1.5},
             "tray": [{"id": "migration-check", "kind": "list", "title": "Migration check", "takenAt": "2026-10-10T09:00:00Z",
                       "numbers": [{"label": "Alpha", "value": "$1.000"}], "split": "sector", "pick": None}]}
old_document = None

def named_boards_prepare():
    global old_document
    first = sql(t.MAIN_DB, """SELECT "Id" FROM "ScratchBoards" ORDER BY "Id" LIMIT 1""")
    if not first:
        return
    old_document = (first, sql(t.MAIN_DB, f"""SELECT "Document"::text FROM "ScratchBoards" WHERE "Id" = {first}"""))
    parts = json.dumps(OLD_PARTS).replace("'", "''")
    sql(t.MAIN_DB, f"""UPDATE "ScratchBoards" SET "Document" = "Document" || '{parts}'::jsonb WHERE "Id" = {first}""")

def named_boards_forward():
    person = sql(t.MAIN_DB, """SELECT "UserId" FROM "ScratchBoards" ORDER BY "Id" LIMIT 1""")
    if not person:
        return None
    first = sql(t.MAIN_DB, f"""SELECT "Id" FROM "ScratchBoards" WHERE "UserId" = {person} ORDER BY "Id" LIMIT 1""")
    view = json.loads(sql(t.MAIN_DB, f"""SELECT coalesce("View"::text, 'null') FROM "ScratchBoards" WHERE "Id" = {first}"""))
    check("going forward moves where the board was left out of its document", view == OLD_PARTS["view"], view)
    tray = json.loads(sql(t.MAIN_DB, f"""SELECT "Items"::text FROM "ScratchTrays" WHERE "UserId" = {person}""") or "null")
    check("and the carry tray into the person's own tray", tray == OLD_PARTS["tray"], tray)
    sql(t.MAIN_DB, f"""UPDATE "ScratchBoards" SET "Pinned" = true, "Name" = 'Kept' WHERE "Id" = {first}""")
    sql(t.MAIN_DB, f"""INSERT INTO "ScratchBoards" ("UserId", "Name", "Pinned", "Document", "CreatedAt", "UpdatedAt")
                       VALUES ({person}, 'Migration check', false, '{{"version":1,"items":[],"lines":[],"groups":[]}}', now(), now())""")
    sql(t.MAIN_DB, f"""INSERT INTO "UserSettings" ("UserId", "Shortcuts", "Mouse", "Theme", "UpdatedAt")
                       VALUES ({person}, '{{"sp.select":["X"]}}', '{{}}', 'dark', now())""")
    return (person, first)

def named_boards_back(kept):
    if not kept:
        print("  (no Scratchpad board in the throwaway database, so losing the extra boards wasn't tried. Open the Scratchpad once)")
        return
    person, first = kept
    left = sql(t.MAIN_DB, f"""SELECT string_agg("Id"::text, ',') FROM "ScratchBoards" WHERE "UserId" = {person}""")
    check("going back keeps only the person's first board", left == first, left)
    document = json.loads(sql(t.MAIN_DB, f"""SELECT "Document"::text FROM "ScratchBoards" WHERE "Id" = {first}"""))
    check("with its document whole, and the view and tray back inside it",
          document == {**json.loads(old_document[1]), **OLD_PARTS}, str(document)[:300])

def named_boards_tidy():
    if not old_document:
        return
    first, text = old_document
    sql(t.MAIN_DB, f"""UPDATE "ScratchBoards" SET "Document" = '{text.replace("'", "''")}'::jsonb WHERE "Id" = {first}""")
    sql(t.MAIN_DB, """UPDATE "ScratchTrays" SET "Items" = coalesce((SELECT jsonb_agg(x) FROM jsonb_array_elements("Items") x
                      WHERE x->>'id' <> 'migration-check'), '[]'::jsonb)""")

# (forward, back), and optionally what to set up before going forward and what to tidy at the very end
FIXTURES = {"AddUserTablesAndManager": (user_tables_forward, user_tables_back),
            "NamedBoardsSettingsTray": (named_boards_forward, named_boards_back, named_boards_prepare, named_boards_tidy)}

# Which migration, and the one before it
names = pg.migrations()
wanted = os.environ.get("MIGRATION") or names[-1]
found = [n for n in names if wanted in (n, n.split("_", 1)[1])]
if not found: sys.exit(f"There's no migration called {wanted} in api_v2/Migrations")
target = found[0]
short = target.split("_", 1)[1]
previous = names[names.index(target) - 1] if names.index(target) > 0 else "0"
print(f"Checking {short} on {t.MAIN_DB} (5433). Going back means going to {previous.split('_', 1)[-1]}.")

pg.nobody_connected(t.MAIN_DB, t.COLLECTOR_DB)

now = applied()
if not now or now[-1] not in (target, previous):
    sys.exit(f"{t.MAIN_DB} is at {now[-1] if now else 'nothing'}, not at {short} or the one before it. "
             "Start the throwaway API once to bring it up to date, then stop it and run this again")

print("building the API (Release)")
pg.build()
safe = os.path.join(t.BACKUPS, "dumps", "migration-" + time.strftime("%Y-%m-%d_%H%M%S"))
os.makedirs(safe, exist_ok=True)
pg.dump(t.MAIN_DB, os.path.join(safe, "main.dump"))
pg.dump(t.COLLECTOR_DB, os.path.join(safe, "collector.dump"))
print(f"  both databases dumped to {safe} first")
start = snapshot()

if now[-1] == target:
    print(f"  {t.MAIN_DB} already has {short}, taking it back first ({update(previous):.1f}s)")

fixture = FIXTURES.get(short)
if fixture and len(fixture) > 2: fixture[2]()

print("\nbefore")
before = snapshot()
print(f"  {len(before['rows'])} tables, {len(before['layout'])} layout lines")

print("\nforward")
took = update(target)
print(f"  took {took:.1f}s")
forward = snapshot()
check("the migration list gained exactly this one", forward["applied"] == before["applied"] + [target],
      forward["applied"][-3:])
allowed = [x.strip() for x in os.environ.get("EXPECT_CHANGED", "").split(",") if x.strip()]
moved = {k: v for k, v in changed(before["rows"], forward["rows"], before["rows"].keys()).items()
         if not any(k.endswith(f'"{a}"') for a in allowed)}
check("every row that was there before is untouched", not moved, moved)
new_tables = sorted(set(forward["rows"]) - set(before["rows"]))
if new_tables: print("  new tables: " + ", ".join(new_tables))

kept = fixture[0]() if fixture else None

print("\nback")
took = update(previous)
print(f"  took {took:.1f}s")
back = snapshot()
check("the migration list is what it was before", back["applied"] == before["applied"], back["applied"][-3:])
check("the layout is exactly what it was before", back["layout"] == before["layout"],
      layout_diff(before["layout"], back["layout"]))
check("every table and row is exactly what it was before", back["rows"] == before["rows"],
      changed(before["rows"], back["rows"]))
if fixture: fixture[1](kept)

print("\nforward again")
took = update(target)
print(f"  took {took:.1f}s")
again = snapshot()
check("the migration list matches the first forward", again["applied"] == forward["applied"], again["applied"][-3:])
check("the layout matches the first forward", again["layout"] == forward["layout"],
      layout_diff(forward["layout"], again["layout"]))
check("every table and row matches the first forward", again["rows"] == forward["rows"],
      changed(forward["rows"], again["rows"]))

if fixture and len(fixture) > 3: fixture[3]()

if os.environ.get("KEEP") != "1":
    pg.restore(os.path.join(safe, "main.dump"), t.MAIN_DB)
    pg.restore(os.path.join(safe, "collector.dump"), t.COLLECTOR_DB)
    ended = snapshot()
    print()
    check("the throwaway databases are loaded back from the dump, every row as at the start",
          ended["rows"] == start["rows"] and ended["applied"] == start["applied"], changed(start["rows"], ended["rows"]))

print("\n" + (f"{len(fails)} failed" if fails else "MIGRATION OK"))
sys.exit(1 if fails else 0)
