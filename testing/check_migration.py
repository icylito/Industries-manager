# A migration goes forward, back and forward again on the throwaway database, and each step is checked:
#   the migration list is right, going back leaves the layout exactly as it was, every row that was there before is
#   untouched, the only losses are the ones the migration's Down says it loses, and going forward again lands exactly
#   where the first forward did. Each step is timed.
#   python3 -I check_migration.py                       the newest migration
#   set MIGRATION=AddScratchFiles & python3 -I check_migration.py      any other one, by its name
#   set CHAIN=state & set MIGRATION=NamedBoardsSettingsTray & ...     one in the chain of what is always current
#   set KEPT=Industries,UserTables & ...                               tables whose rows the Down keeps as forward left them
# Stop the throwaway API first: it applies migrations when it starts and writes while the check compares.
# Throwaway only, like the other checks. Both throwaway databases are dumped first and loaded back at the end, since
# going back loses what the Down names (KEEP=1 leaves the database at the migration it checked instead).
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pg, t
from pg import API, changed, layout_diff, sql, snapshot

check = pg.Checks()
fails = check.fails

# The data chain, or with CHAIN=state the chain of what is always current (backend/Infrastructure/Persistence/Migrations/State)
CHAIN = os.environ.get("CHAIN", "data")
if CHAIN not in pg.CHAINS: sys.exit(f"CHAIN is data or state, not {CHAIN}")
LIST = "applied" if CHAIN == "data" else "state"

def applied():
    return pg.applied(chain=CHAIN)

def update(to):
    try:
        return pg.update(to, chain=CHAIN)
    except RuntimeError as e:
        sys.exit(str(e))

# What a migration's Down is allowed to lose, set up after going forward and looked at after going back.
# A migration without an entry here must come back with nothing lost at all.
# The Tables page: going back loses every table made on it (its Down says so). A manager made before going forward
# stays a manager going back, since accounts are always current and belong to the state chain (backend/Infrastructure/Persistence/StateModel.cs).
manager = None

def user_tables_prepare():
    global manager
    manager = sql(t.MAIN_DB, """SELECT "Id" FROM "Users" WHERE "Role" = 'normal' ORDER BY "Id" LIMIT 1""") or None
    if manager:
        sql(t.MAIN_DB, f"""UPDATE "Users" SET "Role" = 'manager' WHERE "Id" = {manager}""")

def user_tables_forward():
    table = sql(t.MAIN_DB, """INSERT INTO "UserTables" ("Name", "Columns", "RowCount", "CreatedBy", "CreatedAt", "UpdatedAt", "Version")
                              VALUES ('Migration check', '[]', 1, 'check', now(), now(), 1) RETURNING "Id" """).splitlines()[0]
    sql(t.MAIN_DB, f"""INSERT INTO "UserTableRows" ("TableId", "Data", "CreatedBy", "CreatedAt", "UpdatedAt")
                       VALUES ({table}, '{{}}', 'check', now(), now())""")

def user_tables_back(_):
    gone = sql(t.MAIN_DB, """SELECT to_regclass('public."UserTables"') IS NULL""")
    check("going back loses the tables made on the Tables page, as its Down says", gone == "t", gone)
    if not manager:
        print("  (no normal account in the throwaway database, so a manager going back wasn't tried. check_tables.py makes one)")
        return
    role = sql(t.MAIN_DB, f"""SELECT "Role" FROM "Users" WHERE "Id" = {manager}""")
    check("a manager stays a manager, accounts never go back", role == "manager", role)

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

# The one name rule. Before going forward: two companies and two live tables whose names differ only in case,
# spaces and symbols. Going forward flags the later company as a copy of the first and adds the later table's number
# to its name (with a count when that name is taken too); going back puts the older indexes on and keeps those flags
# and names (its Down says so).
# Run with EXPECT_CHANGED=Industries,UserTables.
name_rule = {}

def one_name_prepare():
    cols = sql(t.MAIN_DB, """SELECT string_agg(quote_ident(column_name), ',') FROM information_schema.columns
                             WHERE table_name = 'Industries' AND column_name NOT IN ('Id', 'Name', 'DuplicateOf')""")
    for name in ("Rule Check Co.", "rule-check co"):
        name_rule[name] = sql(t.MAIN_DB, f"""INSERT INTO "Industries" ({cols}, "Name")
            SELECT {cols}, '{name}' FROM "Industries" WHERE "DuplicateOf" IS NULL LIMIT 1 RETURNING "Id" """).splitlines()[0]
    for name in ("Rule Table", "rule-table!"):
        name_rule[name] = sql(t.MAIN_DB, f"""INSERT INTO "UserTables" ("Name", "Columns", "RowCount", "CreatedBy", "CreatedAt", "UpdatedAt", "Version")
            VALUES ('{name}', '[]', 0, 'check', now(), now(), 1) RETURNING "Id" """).splitlines()[0]
    # A third table already holding the name the rename would first pick ("rule-table! (id)" is "Rule Table (id)"
    # by the rule), so the rename has to keep looking (critic, round 1, D1)
    taken = f"Rule Table ({name_rule['rule-table!']})"
    sql(t.MAIN_DB, f"""INSERT INTO "UserTables" ("Name", "Columns", "RowCount", "CreatedBy", "CreatedAt", "UpdatedAt", "Version")
        VALUES ('{taken}', '[]', 0, 'check', now(), now(), 1)""")

def one_name_forward():
    first, later = name_rule["Rule Check Co."], name_rule["rule-check co"]
    flag = sql(t.MAIN_DB, f"""SELECT coalesce("DuplicateOf"::text, 'none') FROM "Industries" WHERE "Id" = {later}""")
    check("going forward flags the later company as a copy of the first", flag == first, flag)
    renamed = sql(t.MAIN_DB, f"""SELECT "Name" FROM "UserTables" WHERE "Id" = {name_rule['rule-table!']}""")
    check("and gives the later table a name no other table has, its number and a count",
          renamed == f"rule-table! ({name_rule['rule-table!']}-2)", renamed)
    try:
        sql(t.MAIN_DB, """INSERT INTO "UserTables" ("Name", "Columns", "RowCount", "CreatedBy", "CreatedAt", "UpdatedAt", "Version")
                          VALUES ('RULE  table', '[]', 0, 'check', now(), now(), 1)""")
        refused = False
    except RuntimeError:
        refused = True
    check("the database itself refuses a third table with the same name by the new rule", refused)
    return None

def one_name_back(_):
    index = sql(t.MAIN_DB, """SELECT count(*) FROM pg_indexes WHERE indexname = 'IX_Industries_Name_IgnoreCase'""")
    check("going back puts the older company index on again", index == "1", index)

def one_name_tidy():
    pass

def one_username_prepare():
    for name in ("rule.k", "rule_k"):
        name_rule[name] = sql(t.MAIN_DB, f"""INSERT INTO "Users" ("Username", "PasswordHash", "Role", "Disabled", "MustChangePassword", "CreatedAt", "CreatedBy")
            VALUES ('{name}', 'x', 'normal', false, true, now(), 'check') RETURNING "Id" """).splitlines()[0]

def one_username_forward():
    flags = sql(t.MAIN_DB, f"""SELECT string_agg("Username" || '=' || "NameClash", ',' ORDER BY "Id") FROM "Users"
                               WHERE "Id" IN ({name_rule['rule.k']}, {name_rule['rule_k']})""")
    check("going forward flags the newer of two usernames that are one name, and not the older", flags == "rule.k=false,rule_k=true", flags)
    return None

def one_username_back(_):
    gone = sql(t.MAIN_DB, """SELECT count(*) FROM information_schema.columns WHERE table_name = 'Users' AND column_name = 'NameClash'""")
    check("going back drops the flag, the accounts stay", gone == "0" and sql(t.MAIN_DB,
          f"""SELECT count(*) FROM "Users" WHERE "Id" IN ({name_rule['rule.k']}, {name_rule['rule_k']})""") == "2", gone)

# (forward, back), and optionally what to set up before going forward and what to tidy at the very end
FIXTURES = {"AddUserTablesAndManager": (user_tables_forward, user_tables_back, user_tables_prepare),
            "NamedBoardsSettingsTray": (named_boards_forward, named_boards_back, named_boards_prepare, named_boards_tidy),
            "OneNameRule": (one_name_forward, one_name_back, one_name_prepare, one_name_tidy),
            "OneUsernameRule": (one_username_forward, one_username_back, one_username_prepare)}

# Which migration, and the one before it
names = pg.migrations(CHAIN)
wanted = os.environ.get("MIGRATION") or names[-1]
found = [n for n in names if wanted in (n, n.split("_", 1)[1])]
if not found: sys.exit(f"There's no migration called {wanted} in backend/Infrastructure/Persistence/Migrations")
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
check("the migration list gained exactly this one", forward[LIST] == before[LIST] + [target],
      forward[LIST][-3:])
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
check("the migration list is what it was before", back[LIST] == before[LIST], back[LIST][-3:])
check("the layout is exactly what it was before", back["layout"] == before["layout"],
      layout_diff(before["layout"], back["layout"]))
# KEPT names tables whose rows the Down leaves as going forward made them (flags, renames: data, not layout),
# so those are compared with the forward picture instead of the one from before
kept = [x.strip() for x in os.environ.get("KEPT", "").split(",") if x.strip()]
expected = {k: (forward["rows"][k] if any(k.endswith(f'"{x}"') for x in kept) else v) for k, v in before["rows"].items()}
check("every table and row is exactly what it was before" + (f" (and {', '.join(kept)} as going forward left them)" if kept else ""),
      back["rows"] == expected, changed(expected, back["rows"]))
if fixture: fixture[1](kept)

print("\nforward again")
took = update(target)
print(f"  took {took:.1f}s")
again = snapshot()
check("the migration list matches the first forward", again[LIST] == forward[LIST], again[LIST][-3:])
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
          ended["rows"] == start["rows"] and ended[LIST] == start[LIST], changed(start["rows"], ended["rows"]))

print("\n" + (f"{len(fails)} failed" if fails else "MIGRATION OK"))
sys.exit(1 if fails else 0)
