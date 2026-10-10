# What the database checks share: psql and pg_dump on the throwaway Postgres (5433), the migration list, a picture
# of the layout and of every row, and moving the throwaway database to a migration with dotnet ef.
# Used by check_migration.py, check_migration_walk.py and check_dump.py. Throwaway only, like the rest of testing/.
import difflib, os, re, shutil, subprocess, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("ADMIN_PASSWORD", "unused")  # t.py asks for it, these checks never sign in
import t

ROOT = os.path.dirname(t.HERE)
API = os.path.join(ROOT, "api_v2")
PASSWORD = os.environ.get("PGPASSWORD", "postgres")
REAL = {"main", "collector", "api_v2", "postgres"}

def connection(db):
    if db in REAL: sys.exit(f"{db} is not a throwaway database")
    return f"Host=localhost;Port=5433;Database={db};Username=postgres;Password={PASSWORD}"

def run(args, stdin=None, binary=False):
    # psql and pg_dump on this machine if there are any, otherwise the ones in the throwaway container.
    # binary: bytes in and out (a dump), otherwise text.
    if shutil.which(args[0]):
        cmd = [args[0], "-h", "localhost", "-p", "5433", "-U", "postgres"] + args[1:]
        env = dict(os.environ, PGPASSWORD=PASSWORD)
    else:
        cmd = ["docker", "exec", "-i", "stock-listing-db", args[0], "-U", "postgres"] + args[1:]
        env = None
    done = subprocess.run(cmd, env=env, input=stdin, capture_output=True,
                          **({} if binary else {"text": True, "encoding": "utf-8"}))
    if done.returncode != 0:
        err = done.stderr.decode("utf-8", "replace") if binary else done.stderr
        raise RuntimeError(f"{args[0]} failed: {err.strip()[-1500:]}")
    return done.stdout

def dump(db, path):
    # The same kind of dump the app's backups make: custom format, no owner
    data = run(["pg_dump", "-Fc", "--no-owner", "-d", db], binary=True)
    with open(path, "wb") as f: f.write(data)
    return len(data)

def dump_tables(path):
    # The tables a dump holds data for, from its table of contents
    with open(path, "rb") as f: listing = run(["pg_restore", "-l"], stdin=f.read(), binary=True).decode()
    return sorted({m.group(1) for m in re.finditer(r"TABLE DATA public (\S+) ", listing)})

def restore(path, db):
    # A fresh database made from a dump. Only ever a throwaway name.
    connection(db)
    run(["psql", "-d", "postgres", "-qAt", "-c", f'DROP DATABASE IF EXISTS "{db}" WITH (FORCE)'])
    run(["psql", "-d", "postgres", "-qAt", "-c", f'CREATE DATABASE "{db}"'])
    with open(path, "rb") as f:
        run(["pg_restore", "--no-owner", "--exit-on-error", "-d", db], stdin=f.read(), binary=True)

def drop(db):
    connection(db)
    run(["psql", "-d", "postgres", "-qAt", "-c", f'DROP DATABASE IF EXISTS "{db}" WITH (FORCE)'])

def sequences(db):
    # Where every id counter is, so rows added after a restore never take an id already used
    return dict(line.split("|", 1) for line in sql(db, "SELECT sequencename || '|' || coalesce(last_value::text, 'unused') "
                                                       "FROM pg_sequences ORDER BY 1").splitlines() if line)

def sql(db, q):
    return run(["psql", "-d", db, "-qAt", "-c", q]).strip()

def applied(db=t.MAIN_DB):
    return sql(db, 'SELECT "MigrationId" FROM "__EFMigrationsHistory" ORDER BY 1').splitlines()

def migrations():
    # Every migration in api_v2/Migrations, oldest first
    return sorted(f[:-3] for f in os.listdir(os.path.join(API, "Migrations")) if re.fullmatch(r"\d{14}_\w+\.cs", f))

def short(name):
    return name.split("_", 1)[-1]

def same_meaning(line):
    # Postgres writes a CHECK back in its own words after a dump is loaded: ANY ((ARRAY['a'::character varying])::text[])
    # comes back as ANY (ARRAY[('a'::character varying)::text]). Same meaning, so the casts and brackets are set aside.
    if "CHECK" not in line: return line
    for noise in ("::character varying", "::text[]", "::text", "(", ")", " "): line = line.replace(noise, "")
    return line

def layout(db=t.MAIN_DB):
    # pg_dump 17.6 and newer write a random \restrict key on every dump, so it and the comments are left out
    text = run(["pg_dump", "-d", db, "--schema-only", "--no-owner", "--no-privileges"])
    return [same_meaning(line) for line in text.splitlines()
            if line.strip() and not line.startswith(("--", "\\restrict", "\\unrestrict", "SET ", "SELECT pg_catalog.set_config"))]

def rows(db, label=None):
    # Row count and an md5 over every row in a fixed order, for every table but the migration list itself
    tables = sql(db, "SELECT format('%I.%I', schemaname, tablename) FROM pg_tables "
                     "WHERE schemaname NOT IN ('pg_catalog', 'information_schema') ORDER BY 1").splitlines()
    out = {}
    for name in tables:
        if name.endswith('"__EFMigrationsHistory"'): continue
        out[f"{label or db}.{name}"] = sql(db, f"SELECT count(*) || ' rows ' || md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) FROM {name} x")
    return out

def counts(picture):
    return {k: int(v.split()[0]) for k, v in picture.items()}

def snapshot(main=t.MAIN_DB, collector=t.COLLECTOR_DB):
    # Labelled by role, so a copy restored under another name compares with the original
    return {"applied": applied(main), "layout": layout(main),
            "rows": {**rows(main, "main"), **rows(collector, "collector")}}

def changed(before, after, tables=None):
    keys = tables if tables is not None else sorted(set(before) | set(after))
    return {k: (before.get(k), after.get(k)) for k in keys if before.get(k) != after.get(k)}

def layout_diff(a, b):
    return "\n".join(list(difflib.unified_diff(a, b, "before", "after", lineterm="", n=0))[:30])

def tables_in(layout_lines):
    return {m.group(1) for line in layout_lines for m in [re.match(r'CREATE TABLE public\."?(\w+)"? ', line)] if m}

def build():
    subprocess.run(["dotnet", "build", API, "-c", "Release", "-v", "q", "-nologo"], check=True, capture_output=True)

def update(to, db=t.MAIN_DB):
    # to is a migration's full name, or "0" for none at all
    started = time.time()
    done = subprocess.run(["dotnet", "ef", "database", "update", to, "--project", API, "--configuration", "Release",
                           "--no-build", "--connection", connection(db)],
                          cwd=ROOT, capture_output=True, text=True, encoding="utf-8",
                          env=dict(os.environ, ASPNETCORE_ENVIRONMENT="Throwaway"))
    if done.returncode != 0:
        # The connection string carries the password, so it never gets printed
        raise RuntimeError(f"dotnet ef database update {short(to)} failed:\n" + (done.stdout + done.stderr).replace(PASSWORD, "***")[-3000:])
    return time.time() - started

def nobody_connected(*dbs):
    names = ", ".join(f"'{d}'" for d in dbs)
    others = sql("postgres", f"SELECT count(*) FROM pg_stat_activity WHERE datname IN ({names})")
    if others != "0":
        sys.exit(f"{others} connection(s) are open on {', '.join(dbs)}. Stop the throwaway API first, "
                 "it applies migrations when it starts and writes while a check compares")

class Checks:
    def __init__(self):
        self.fails = []
    def __call__(self, label, ok, detail=""):
        print(("  ok   " if ok else "  FAIL ") + label + ("" if ok else f"  [{str(detail)[:600]}]"))
        if not ok: self.fails.append(label)
        return ok
