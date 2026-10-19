# Deleting a saved version on History: it goes for good with its rows, a pinned one stays, only an admin may do it,
# and a delete that meets a restore of the same version waits for it instead of pulling the rows out from under it.
# Throwaway API only, like the other checks.
#   python3 -I check_versions.py
import os, secrets, sys, threading
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import t
from t import call, login

fails = []
def check(label, ok, detail=""):
    print(("  ok   " if ok else "  FAIL ") + label + ("" if ok else f"  [{str(detail)[:300]}]"))
    if not ok: fails.append(label)

def sql(q):
    import shutil, subprocess
    if shutil.which("psql"): return t.psql(t.COLLECTOR_DB, q)
    return subprocess.run(["docker", "exec", "stock-listing-db", "psql", "-U", "postgres", "-d", t.COLLECTOR_DB, "-qAt", "-c", q],
                          capture_output=True, text=True, check=True).stdout.strip()

def account(admin, role):
    name = f"chk{role[:3]}{secrets.token_hex(3)}"
    s, b = call("POST", "/users", {"username": name, "role": role}, admin)
    assert s == 201, (s, b)
    temp = b["temporaryPassword"]
    token, _ = login(name, temp)
    new = "Chk-" + secrets.token_urlsafe(14)
    assert call("POST", "/auth/password", {"current": temp, "new": new}, token)[0] < 300
    return login(name, new)[0]

def ids():
    return [v["id"] for v in call("GET", "/history/versions", token=admin)[1]]

admin, _ = login("admin", t.ADMIN_PASSWORD)
manager = account(admin, "manager")

# Each new field saves a copy of the table first, so three fields give three fresh versions
labels = [f"Ver check {secrets.token_hex(2)} {i}" for i in range(3)]
keys = []
for label in labels:
    s, b = call("POST", "/schema/fields", {"label": label, "type": "text", "required": False, "maxLength": 10, "min": None, "max": None}, admin)
    assert s == 200, (s, b)
    keys.append(next(f["key"] for f in b["fields"] if f["label"] == label))
newest = ids()[:3]
a, b, c = newest[2], newest[1], newest[0]
print(f"made versions #{a}, #{b} and #{c}")

print("who may delete")
check("a manager can't delete a saved version", call("DELETE", f"/history/versions/{a}", token=manager)[0] == 403)
check("and it is still there", a in ids())

print("a pinned version stays")
call("PUT", f"/history/versions/{b}/pin", {"pinned": True}, admin)
s, body = call("DELETE", f"/history/versions/{b}", token=admin)
check("deleting a pinned version is refused and says why", s == 409 and "pinned" in str(body).lower(), (s, body))
check("its rows are all still there", sql(f"SELECT count(*) FROM version_rows WHERE version_id = {b}") ==
      sql(f"SELECT row_count FROM versions WHERE id = {b}"))
call("PUT", f"/history/versions/{b}/pin", {"pinned": False}, admin)

print("a delete")
rows_before = int(sql(f"SELECT count(*) FROM version_rows WHERE version_id = {a}"))
s, body = call("DELETE", f"/history/versions/{a}", token=admin)
check("an admin deletes it", s == 200 and body.get("deleted") == a, (s, body))
check("it is off the list", a not in ids())
check("View says it isn't there", call("GET", f"/history/versions/{a}", token=admin)[0] == 404)
check(f"its {rows_before} saved rows went with it", sql(f"SELECT count(*) FROM version_rows WHERE version_id = {a}") == "0")
check("the versions next to it are untouched", b in ids() and c in ids())
check("deleting it again says it isn't there", call("DELETE", f"/history/versions/{a}", token=admin)[0] == 404)

print("a delete meeting a restore of the same version")
results = {}
def restore(): results["restore"] = call("POST", f"/history/versions/{c}/restore", {"note": "check the delete waits for me"}, admin)[0]
def delete(): results["delete"] = call("DELETE", f"/history/versions/{c}", token=admin)[0]
threads = [threading.Thread(target=restore), threading.Thread(target=delete)]
for th in threads: th.start()
for th in threads: th.join()
check("neither one fails with a server error", 500 not in results.values(), results)
check("either the restore went first and the delete after it, or the delete went first and the restore found nothing",
      results in ({"restore": 200, "delete": 200}, {"restore": 404, "delete": 200}), results)
check("the version is gone either way", c not in ids())

for key in keys:
    version = call("GET", "/schema", token=admin)[1]["version"]
    call("DELETE", f"/schema/fields/{key}?basedOn={version}", token=admin)

print("\n" + (f"{len(fails)} failed" if fails else "VERSIONS OK"))
sys.exit(1 if fails else 0)
