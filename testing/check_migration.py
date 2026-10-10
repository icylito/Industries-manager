# A migration goes forward, back and forward again on the throwaway database, and each step is checked:
#   the migration list is right, going back leaves the layout exactly as it was, every row that was there before is
#   untouched, the only losses are the ones the migration's Down says it loses, and going forward again lands exactly
#   where the first forward did. Each step is timed.
#   python3 -I check_migration.py                       the newest migration
#   set MIGRATION=AddScratchFiles & python3 -I check_migration.py      any other one, by its name
# Stop the throwaway API first: it applies migrations when it starts and writes while the check compares.
# Throwaway only, like the other checks. It ends with the database at the migration it checked.
import difflib, json, os, re, shutil, subprocess, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("ADMIN_PASSWORD", "unused")  # t.py asks for it, this check never signs in
import t

ROOT = os.path.dirname(t.HERE)
API = os.path.join(ROOT, "api_v2")
PASSWORD = os.environ.get("PGPASSWORD", "postgres")
CONNECTION = f"Host=localhost;Port=5433;Database={t.MAIN_DB};Username=postgres;Password={PASSWORD}"

fails = []
def check(label, ok, detail=""):
    print(("  ok   " if ok else "  FAIL ") + label + ("" if ok else f"  [{str(detail)[:600]}]"))
    if not ok: fails.append(label)

def run(args):
    # psql and pg_dump on this machine if there are any, otherwise the ones in the throwaway container
    if shutil.which(args[0]):
        cmd = [args[0], "-h", "localhost", "-p", "5433", "-U", "postgres"] + args[1:]
        env = dict(os.environ, PGPASSWORD=PASSWORD)
    else:
        cmd = ["docker", "exec", "stock-listing-db", args[0], "-U", "postgres"] + args[1:]
        env = None
    return subprocess.run(cmd, env=env, capture_output=True, text=True, encoding="utf-8", check=True).stdout

def sql(db, q):
    return run(["psql", "-d", db, "-qAt", "-c", q]).strip()

def applied():
    return sql(t.MAIN_DB, 'SELECT "MigrationId" FROM "__EFMigrationsHistory" ORDER BY 1').splitlines()

def layout():
    # pg_dump 17.6 and newer write a random \restrict key on every dump, so it and the comments are left out
    text = run(["pg_dump", "-d", t.MAIN_DB, "--schema-only", "--no-owner", "--no-privileges"])
    return [line for line in text.splitlines()
            if line.strip() and not line.startswith(("--", "\\restrict", "\\unrestrict", "SET ", "SELECT pg_catalog.set_config"))]

def rows(db):
    # Row count and an md5 over every row in a fixed order, for every table but the migration list itself
    tables = sql(db, "SELECT format('%I.%I', schemaname, tablename) FROM pg_tables "
                     "WHERE schemaname NOT IN ('pg_catalog', 'information_schema') ORDER BY 1").splitlines()
    out = {}
    for name in tables:
        if name.endswith('"__EFMigrationsHistory"'): continue
        out[f"{db}.{name}"] = sql(db, f"SELECT count(*) || ' rows ' || md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) FROM {name} x")
    return out

def snapshot():
    return {"applied": applied(), "layout": layout(), "rows": {**rows(t.MAIN_DB), **rows(t.COLLECTOR_DB)}}

def changed(before, after, tables=None):
    keys = tables if tables is not None else sorted(set(before) | set(after))
    return {k: (before.get(k), after.get(k)) for k in keys if before.get(k) != after.get(k)}

def layout_diff(a, b):
    return "\n".join(list(difflib.unified_diff(a, b, "before", "after", lineterm="", n=0))[:30])

def update(to):
    started = time.time()
    done = subprocess.run(["dotnet", "ef", "database", "update", to, "--project", API, "--configuration", "Release",
                           "--no-build", "--connection", CONNECTION],
                          cwd=ROOT, capture_output=True, text=True, encoding="utf-8",
                          env=dict(os.environ, ASPNETCORE_ENVIRONMENT="Throwaway"))
    if done.returncode != 0:
        # The connection string carries the password, so it never gets printed
        sys.exit(f"dotnet ef database update {to} failed:\n" + (done.stdout + done.stderr).replace(PASSWORD, "***")[-3000:])
    return time.time() - started

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
names = sorted(f[:-3] for f in os.listdir(os.path.join(API, "Migrations")) if re.fullmatch(r"\d{14}_\w+\.cs", f))
wanted = os.environ.get("MIGRATION") or names[-1]
found = [n for n in names if wanted in (n, n.split("_", 1)[1])]
if not found: sys.exit(f"There's no migration called {wanted} in api_v2/Migrations")
target = found[0]
short = target.split("_", 1)[1]
previous = names[names.index(target) - 1] if names.index(target) > 0 else "0"
print(f"Checking {short} on {t.MAIN_DB} (5433). Going back means going to {previous.split('_', 1)[-1]}.")

others = sql("postgres", f"SELECT count(*) FROM pg_stat_activity WHERE datname IN ('{t.MAIN_DB}', '{t.COLLECTOR_DB}')")
if others != "0":
    sys.exit(f"{others} connection(s) are open on the throwaway databases. Stop the throwaway API first, "
             "it applies migrations when it starts and writes while this check compares")

now = applied()
if not now or now[-1] not in (target, previous):
    sys.exit(f"{t.MAIN_DB} is at {now[-1] if now else 'nothing'}, not at {short} or the one before it. "
             "Start the throwaway API once to bring it up to date, then stop it and run this again")

print("building the API (Release)")
subprocess.run(["dotnet", "build", API, "-c", "Release", "-v", "q", "-nologo"], check=True, capture_output=True)

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

print("\n" + (f"{len(fails)} failed" if fails else "MIGRATION OK"))
sys.exit(1 if fails else 0)
