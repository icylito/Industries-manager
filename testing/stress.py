# Race test: restores from a backup and from History while adds, edits, deletes, imports, rules and settings saves hit the API.
# python3 -I stress.py <rounds>
import sys, os, time, subprocess, threading, random, collections, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import t
from t import call
ROUNDS = int(sys.argv[1]) if len(sys.argv) > 1 else 30
ROWS = int(sys.argv[2]) if len(sys.argv) > 2 else 300
t.TOK, _ = t.login("admin", t.ADMIN_PASSWORD)
def sql(db, q): return t.psql(db, q)

# starting point: 300 rows, one backup of exactly that, one saved version of it
sql(t.MAIN_DB, """DELETE FROM "Industries" """)
stamp = int(time.time())
sql(t.MAIN_DB, f"""INSERT INTO "Industries" ("Name","Sector","Price") SELECT 'Stress {stamp} ' || g, 'Public Sector', 1 FROM generate_series(1, {ROWS}) g""")
s, bk = call("POST", "/backups", {}); assert s == 200, bk
s, schema = call("GET", "/schema"); s, b = call("PUT", "/schema", {"note": "stress base", "fields": schema["fields"], "basedOn": schema["version"]}); assert s == 200, b
s, versions = call("GET", "/history/versions"); base_version = versions[0]["id"]
# pinned, so the retention the settings worker saves never removes the version the rounds restore from
s, b = call("PUT", f"/history/versions/{base_version}/pin", {"pinned": True}); assert s == 204, b
print("backup", bk["id"], "version", base_version, "rows", bk["rowCount"])

statuses = collections.Counter()
errors = []
lock = threading.Lock()
def note(kind, s, b):
    with lock:
        statuses[(kind, s)] += 1
        if s >= 500 and s != 503: errors.append((kind, s, str(b)[:200]))
        if s == 503 and "Someone else is changing" in str(b): errors.append((kind, s, "lock wait ran out"))

def worker(kind, stop, n):
    rnd = random.Random(n)
    while not stop.is_set():
        try:
            if kind == "add":
                s, b = call("POST", "/industries", {"name": f"Race {n} {rnd.random()}", "sector": "Private Sector", "price": 2, "release": None, "extra": {}})
                note(kind, s, b)
            elif kind == "edit":
                s, rows = call("GET", "/industries")
                if s == 200 and rows:
                    r = rnd.choice(rows)
                    s, b = call("PUT", f"/industries/update/{r['id']}", {"name": r["name"], "sector": "Public Sector", "price": round(rnd.random() * 9, 2), "release": None})
                    note(kind, s, b)
            elif kind == "delete":
                s, rows = call("GET", "/industries")
                if s == 200 and rows:
                    s, b = call("DELETE", f"/industries/{rnd.choice(rows)['id']}"); note(kind, s, b)
            elif kind == "import":
                s, b = call("POST", f"/history/versions/{base_version}/import", {"confirm": True, "skipDuplicates": True}); note(kind, s, b)
            elif kind == "rules":
                s, schema = call("GET", "/schema")
                if s == 200:
                    s, b = call("PUT", "/schema", {"note": f"race {n}", "fields": schema["fields"], "basedOn": schema["version"]}); note(kind, s, b)
            elif kind == "settings":
                s, b = call("PUT", "/history/settings", {"keepVersions": rnd.choice([None, 50, 80]), "keepDays": None}); note(kind, s, b)
            elif kind == "backup":
                s, b = call("POST", "/backups", {}); note(kind, s, b)
            elif kind == "read":
                s, b = call("GET", "/industries"); note(kind, s, b)
        except Exception as ex:
            with lock: errors.append((kind, "exception", str(ex)[:200]))
        time.sleep(rnd.random() * 0.2)

kinds = ["add", "edit", "delete", "import", "rules", "settings", "backup", "read"]
t_start = time.time()
restore_times = []
for rnd_no in range(1, ROUNDS + 1):
    stop = threading.Event()
    threads = [threading.Thread(target=worker, args=(k, stop, i), daemon=True) for i, k in enumerate(kinds)]
    for th in threads: th.start()
    time.sleep(0.3)
    # two restores at the same moment, one from the backup and one from History, plus a second backup restore right behind
    results = {}
    def restore_backup(key):
        t0 = time.time(); s, b = call("POST", f"/backups/{bk['id']}/restore", {"confirm": "RESTORE"}); results[key] = (s, b, time.time() - t0)
    def restore_history(key):
        t0 = time.time(); s, b = call("POST", f"/history/versions/{base_version}/restore", {"confirm": "RESTORE"}); results[key] = (s, b, time.time() - t0)
    rs = [threading.Thread(target=restore_backup, args=("b1",)), threading.Thread(target=restore_history, args=("h1",)), threading.Thread(target=restore_backup, args=("b2",))]
    for r in rs: r.start()
    for r in rs: r.join()
    stop.set()
    for th in threads: th.join(timeout=30)
    for key, (s, b, dt) in results.items():
        note("restore-" + key[0], s, b); restore_times.append(dt)
        if s != 200: errors.append(("restore " + key, s, str(b)[:200]))
    # after the dust settles: the table is readable, the rules load, and nothing is stuck pending
    s, rows = call("GET", "/industries"); assert s == 200, rows
    s, h = call("GET", "/health"); assert h["state"] == "ready" and h["history"]["ready"], h
    pending = sql(t.COLLECTOR_DB, "SELECT count(*) FROM row_changes WHERE status = 'pending'")
    scratch = sql("postgres", "SELECT count(*) FROM pg_database WHERE datname = 'main_restore_scratch'")
    dup_names = sql(t.MAIN_DB, 'SELECT count(*) FROM (SELECT lower(btrim("Name")) n FROM "Industries" WHERE "DuplicateOf" IS NULL GROUP BY n HAVING count(*) > 1) x')
    if pending != "0" or scratch != "0" or dup_names != "0":
        errors.append((f"round {rnd_no}", "state", f"pending={pending} scratch={scratch} dup_names={dup_names}"))
    print(f"round {rnd_no:2d}: rows {len(rows):5d}, restores {[(k, v[0], round(v[2],1)) for k, v in sorted(results.items())]}, errors so far {len(errors)}", flush=True)

print(f"\n{ROUNDS} rounds in {time.time()-t_start:.0f}s. restore times min/avg/max {min(restore_times):.1f}/{sum(restore_times)/len(restore_times):.1f}/{max(restore_times):.1f}s")
print("answers by kind and status:")
for (k, s), c in sorted(statuses.items()): print(f"  {k:10s} {s}: {c}")
print("errors:", len(errors))
for e in errors[:30]: print("  ", e)
print("STRESS", "OK" if not errors else "FAILED")
