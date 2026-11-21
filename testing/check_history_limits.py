# What the History page's API refuses and what it asks for, found by the stress test of 2026-10-11:
# a restore note has a length limit, a stored reason can't be made huge again, an import has to say what to do about
# rows that are already in the table, and no JSON body can be bigger than the limit. Throwaway API only, like the others.
#   python3 -I check_history_limits.py
import os, secrets, sys, urllib.error, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shutil, subprocess
import t
from t import call, login

fails = []
def check(label, ok, detail=""):
    print(("  ok   " if ok else "  FAIL ") + label + ("" if ok else f"  [{str(detail)[:300]}]"))
    if not ok: fails.append(label)

# psql on the history database: this PC's if there is one, otherwise the one in the database container.
# PGPORT and PGPASSWORD change where and as whom it asks, for a Postgres that isn't the container's on 5433.
def sql(q, check_=True):
    if shutil.which("psql"):
        env = dict(t.PG_ENV, PGPASSWORD=os.environ.get("PGPASSWORD", "postgres"))
        return subprocess.run(["psql", "-h", "localhost", "-p", os.environ.get("PGPORT", "5433"), "-U", "postgres", "-d", t.COLLECTOR_DB, "-qAt", "-c", q],
                              env=env, capture_output=True, text=True, check=check_).stdout.strip()
    return subprocess.run(["docker", "exec", "stock-listing-db", "psql", "-U", "postgres", "-d", t.COLLECTOR_DB, "-qAt", "-c", q],
                          capture_output=True, text=True, check=check_).stdout.strip()

admin, _ = login("admin", t.ADMIN_PASSWORD)
versions = lambda: call("GET", "/history/versions", token=admin)[1]
rows = lambda: len(call("GET", "/industries", token=admin)[1])

# A few rows of its own with names nothing else has, then a saved copy that holds them: each new field saves one
tag = secrets.token_hex(3)
made = []
for i in range(3):
    s, b = call("POST", "/industries", {"name": f"Hist limit {tag} {i}", "sector": "Public Sector", "price": 1.5}, admin)
    assert s == 201, (s, b)
    made.append(b["id"])
s, b = call("POST", "/schema/fields", {"label": f"Hist limit {tag}", "type": "text", "required": False, "maxLength": 10, "min": None, "max": None}, admin)
assert s == 200, (s, b)
source = versions()[0]["id"]
print(f"made version #{source} with {len(made)} rows of its own")

print("\n1. The restore note")
before = len(versions())
s, b = call("POST", f"/history/versions/{source}/restore", {"note": "x" * 301}, admin)
check("301 characters is refused and says the limit", s == 400 and "300" in str(b), (s, b))
s, b = call("POST", f"/history/versions/{source}/restore", {"note": "x" * 9}, admin)
check("9 characters is still refused", s == 400, (s, b))
check("a refused note saves no copy", len(versions()) == before, (before, len(versions())))
s, b = call("POST", f"/history/versions/{source}/restore", {"note": "\U0001F600" * 151}, admin)
check("151 emoji (302 characters, as the page counts them) is refused", s == 400, (s, b))
s, b = call("POST", f"/history/versions/{source}/restore", {"note": "\U0001F600" * 150}, admin)
check("150 emoji (exactly 300) is accepted", s == 200, (s, b))
s, b = call("POST", f"/history/versions/{source}/restore", {"note": "y" * 300}, admin)
check("exactly 300 characters is accepted", s == 200, (s, b))
check("the copy it saved carries the whole note", versions()[0]["reason"].endswith("y" * 300), versions()[0]["reason"][-40:])

print("\n2. A stored reason can't be made huge")
check("the history database has the length rule", sql("SELECT count(*) FROM pg_constraint WHERE conname = 'versions_reason_length'") == "1")
newest = versions()[0]["id"]
out = sql(f"UPDATE versions SET reason = repeat('x', 5000) WHERE id = {newest}", check_=False)
check("it refuses a new 5000 character reason", sql(f"SELECT char_length(reason) FROM versions WHERE id = {newest}") != "5000", out)
# A version saved before the rule existed: put one in by hand, then look at what the page's list does with it
sql("ALTER TABLE versions DROP CONSTRAINT versions_reason_length")
sql(f"UPDATE versions SET reason = repeat('L', 5000) WHERE id = {newest}")
sql("ALTER TABLE versions ADD CONSTRAINT versions_reason_length CHECK (char_length(reason) <= 1000) NOT VALID")
listed = next(v for v in versions() if v["id"] == newest)
check("the list clips an old long reason to 1000 and says it was cut", len(listed["reason"]) == 1000 and listed["reason"].endswith("…"), len(listed["reason"]))
s, one = call("GET", f"/history/versions/{newest}", token=admin)
check("the version's own answer keeps all of it", s == 200 and len(one["reason"]) == 5000, (s, len(one.get("reason", ""))))
sql(f"UPDATE versions SET reason = 'checked by check_history_limits' WHERE id = {newest}")

print("\n3. The biggest JSON body")
def raw_post(size):
    body = b'{"username":"x","password":"' + b"p" * size + b'"}'
    req = urllib.request.Request(t.BASE + "/auth/login", data=body, method="POST", headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r: return r.status
    except urllib.error.HTTPError as e: return e.code
    except Exception as e: return type(e).__name__
check("a body under 2 MB is read (and then refused for its password, not its size)", raw_post(1_900_000) in (400, 401), raw_post(1_900_000))
check("a body over 2 MB is refused as too large", raw_post(2_200_000) in (413, "ConnectionAbortedError", "ConnectionResetError", "BrokenPipeError"), raw_post(2_200_000))

print("\n4. An import has to say what to do about rows already in the table")
# The source version holds the three rows and so does the table now, so every one of them is a duplicate
n0, v0 = rows(), len(versions())
for label, body in (("an empty body", {}), ("only confirm", {"confirm": True}), ("skipDuplicates null", {"confirm": True, "skipDuplicates": None})):
    s, b = call("POST", f"/history/versions/{source}/import", body, admin)
    check(f"{label} is answered 409 asking for a choice, with the counts",
          s == 409 and isinstance(b, dict) and b.get("needsDecision") == "duplicates" and b.get("similar", 0) >= len(made), (s, b))
check("nothing was added and no copy was saved", rows() == n0 and len(versions()) == v0, (n0, rows(), v0, len(versions())))
s, b = call("POST", f"/history/versions/{source}/import/preview", {}, admin)
check("the preview says nothing was brought back from it yet", s == 200 and b.get("alreadyImportedFromThisVersion") == 0, (s, b))
s, b = call("POST", f"/history/versions/{source}/import", {"confirm": True, "skipDuplicates": True}, admin)
check("skipping duplicates when all are duplicates says there is nothing new", s == 409, (s, b))
s, b = call("POST", f"/history/versions/{source}/import", {"confirm": True, "skipDuplicates": False}, admin)
check("an explicit false adds them as flagged copies", s == 200 and b.get("imported", 0) >= len(made) and b.get("similar", 0) >= len(made), (s, b))
s, b = call("POST", f"/history/versions/{source}/import/preview", {}, admin)
check("and the preview now says how many came from this version", s == 200 and b.get("alreadyImportedFromThisVersion", 0) >= len(made), (s, b))

# Put the table back the way it was
call("POST", f"/history/versions/{source}/restore", {"note": "check_history_limits putting the table back"}, admin)
for i in made:
    call("DELETE", f"/industries/{i}", token=admin)

print()
if fails:
    print(f"{len(fails)} failed:")
    for f in fails: print("  -", f)
    sys.exit(1)
print("all passed")
