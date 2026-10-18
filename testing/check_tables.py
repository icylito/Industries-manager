# The Tables page's API on the throwaway API: making, changing, filling, limiting and deleting tables, who may
# do what, and the readable copies in the mirror folder. Makes its own manager and normal accounts.
#   python3 -I check_tables.py
# MIRROR is the throwaway API's UserTables:Mirror folder (default testing/throwaway-backups/user-tables).
import json, os, secrets, shutil, subprocess, sys, threading, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import t
from t import call, login

# psql on this PC if there is one, otherwise the one inside the Docker database
def sql(q):
    if shutil.which("psql"): return t.psql(t.MAIN_DB, q)
    return subprocess.run(["docker", "exec", "stock-listing-db", "psql", "-U", "postgres", "-d", t.MAIN_DB, "-qAt", "-c", q],
                          capture_output=True, text=True, check=True).stdout.strip()


MIRROR = os.environ.get("MIRROR", os.path.join(t.HERE, "throwaway-backups", "user-tables"))
fails = []
def check(label, ok, detail=""):
    print(("  ok   " if ok else "  FAIL ") + label + ("" if ok else f"  [{str(detail)[:300]}]"))
    if not ok: fails.append(label)

def account(admin, role):
    name = f"chk{role[:3]}{secrets.token_hex(3)}"
    s, b = call("POST", "/users", {"username": name, "role": role}, admin)
    assert s == 201, (s, b)
    temp = b["temporaryPassword"]
    token, _ = login(name, temp)
    new = "Chk-" + secrets.token_urlsafe(14)
    s, b = call("POST", "/auth/password", {"current": temp, "new": new}, token)
    assert s < 300, (s, b)
    return login(name, new)[0]

admin, _ = login("admin", t.ADMIN_PASSWORD)
manager = account(admin, "manager")
normal = account(admin, "normal")

# Start from no tables, so the limit checks count from zero
s, tables = call("GET", "/tables", token=admin)
for tb in tables: call("DELETE", f"/tables/{tb['id']}", token=admin)
sql('DELETE FROM "UserTables"')

print("making a table")
cols = [{"label": "Company", "type": "text", "required": True, "maxLength": 40},
        {"label": "Score", "type": "number", "min": 0, "max": 100},
        {"label": "Met on", "type": "date"},
        {"label": "Stage", "type": "text", "options": ["Lead", "Won", "Lost"]}]
s, b = call("POST", "/tables", {"name": "Leads", "columns": cols}, manager)
check("a manager makes a table", s == 201, (s, b))
tid = b["id"]; keys = {c["label"]: c["key"] for c in b["columns"]}
check("column keys are made by the API", keys == {"Company": "company", "Score": "score", "Met on": "met_on", "Stage": "stage"}, keys)
s, b = call("POST", "/tables", {"name": "  LEADS ", "columns": cols}, manager)
check("the same name in other case is refused", s == 409, (s, b))
s, b = call("POST", "/tables", {"name": "x", "columns": [{"label": "A", "type": "blob"}]}, manager)
check("an unknown column type is refused", s == 400, (s, b))
s, b = call("POST", "/tables", {"name": "Nope", "columns": cols}, normal)
check("a normal account can't make a table", s == 403, (s, b))
s, b = call("POST", "/tables", {"name": "Nope", "columns": cols})
check("a guest can't make a table", s == 401, (s, b))
s, b = call("GET", "/tables")
check("a guest can't read tables", s == 401, (s, b))
s, b = call("GET", "/tables", token=normal)
check("a normal account can read tables", s == 200 and any(x["id"] == tid for x in b), (s, b))

print("rows")
def add(values, token=manager): return call("POST", f"/tables/{tid}/rows", {"values": values}, token)
s, r1 = add({"company": "Acme", "score": 80, "met_on": "2026-10-01", "stage": "lead"})
check("a good row is saved", s == 201, (s, r1))
check("a choice is stored in the list's own spelling", s == 201 and r1["data"]["stage"] == "Lead", r1)
s, b = add({"company": "", "score": 5})
check("a missing required value is refused", s == 400 and "company" in json.dumps(b), (s, b))
s, b = add({"company": "B", "score": 101})
check("a number over the max is refused", s == 400 and "score" in json.dumps(b), (s, b))
s, b = add({"company": "B", "met_on": "10/01/2026"})
check("a date in the wrong shape is refused", s == 400, (s, b))
s, b = add({"company": "B", "stage": "Maybe"})
check("a value outside the choices is refused", s == 400, (s, b))
s, b = add({"company": "B", "nosuch": 1})
check("an unknown key is refused", s == 400 and "nosuch" in json.dumps(b), (s, b))
s, b = add({"company": "x" * 41})
check("text over max length is refused", s == 400, (s, b))
s, b = add({"company": "Normal Co"}, normal)
check("a normal account can't add rows", s == 403, (s, b))
for i in range(5): add({"company": f"Firm {i}", "score": i * 10})
s, page = call("GET", f"/tables/{tid}/rows?sort=score&dir=desc&size=3", token=normal)
check("rows page, sort by a number column", s == 200 and page["total"] == 6 and [r["data"]["score"] for r in page["rows"]] == [80, 40, 30], page)
s, page = call("GET", f"/tables/{tid}/rows?q=firm%203", token=normal)
check("search finds by value", s == 200 and page["total"] == 1, page)
s, page = call("GET", f"/tables/{tid}/rows?q=%25", token=normal)
check("a % in the search is plain text, not a wildcard", s == 200 and page["total"] == 0, page)
s, page = call("GET", f"/tables/{tid}/rows?sort=company%27%3Bdrop%20table%20x%3B--", token=normal)
check("a junk sort key is ignored", s == 200 and page["total"] == 6, (s, page))

s, b = call("PUT", f"/tables/{tid}/rows/{r1['id']}", {"values": {"score": 90}, "updatedAt": r1["updatedAt"]}, manager)
check("editing a row keeps the values not sent", s == 200 and b["data"]["company"] == "Acme" and b["data"]["score"] == 90, (s, b))
s, b2 = call("PUT", f"/tables/{tid}/rows/{r1['id']}", {"values": {"score": 91}, "updatedAt": r1["updatedAt"]}, manager)
check("an edit from a stale page is refused", s == 409, (s, b2))
r1 = b

print("changing columns")
s, tb = call("GET", f"/tables/{tid}", token=manager)
ver = tb["version"]
edit = [{"key": "company", "label": "Company", "type": "text", "required": True, "maxLength": 40},
        {"key": "score", "label": "Score", "type": "number", "min": 0, "max": 100},
        {"key": "met_on", "label": "Met on", "type": "date"}]
s, b = call("PUT", f"/tables/{tid}", {"columns": edit, "version": ver}, manager)
check("removing a column hides it", s == 200 and any(c["key"] == "stage" and c["hidden"] for c in b["columns"]), (s, b))
ver = b["version"]
s, b = call("PUT", f"/tables/{tid}", {"columns": edit, "version": ver - 1}, manager)
check("a column change from a stale page is refused", s == 409, (s, b))
s, b = call("PUT", f"/tables/{tid}", {"columns": edit + [{"key": "stage", "label": "Stage", "type": "text", "options": ["Lead", "Won", "Lost"]}], "version": ver}, manager)
s2, row = call("GET", f"/tables/{tid}/rows?q=acme", token=manager)
check("putting a column back brings its values back", s == 200 and row["rows"][0]["data"].get("stage") == "Lead", (s, b, row))
ver = b["version"]
tight = [dict(c) for c in b["columns"] if not c["hidden"]]
for c in tight:
    if c["key"] == "score": c["max"] = 50
s, b = call("PUT", f"/tables/{tid}", {"columns": tight, "version": ver}, manager)
check("a tighter rule that rows break is refused, and says how many", s == 409 and "1 row" in json.dumps(b), (s, b))
for c in tight:
    if c["key"] == "score": c.pop("max", None); c.pop("min", None); c["type"] = "text"
s, b = call("PUT", f"/tables/{tid}", {"columns": tight, "version": ver}, manager)
s2, row = call("GET", f"/tables/{tid}/rows?q=acme", token=manager)
check("a type change rewrites the values (number to text)", s == 200 and row["rows"][0]["data"]["score"] == "90", (s, b, row))
ver = b["version"]
for c in tight:
    if c["key"] == "company": c["type"] = "number"; c.pop("maxLength", None)
s, b = call("PUT", f"/tables/{tid}", {"columns": tight, "version": ver}, manager)
check("a type change that values can't take is refused", s == 409, (s, b))
s, b = call("PUT", f"/tables/{tid}", {"columns": [{"label": f"C{i}", "type": "text"} for i in range(21)], "version": ver}, manager)
check("more than 20 columns is refused", s == 400 and "20" in json.dumps(b), (s, b))

print("bin")
s, b = call("DELETE", f"/tables/{tid}", token=manager)
check("a table goes to the bin", s == 200, (s, b))
s, b = call("GET", f"/tables/{tid}/rows", token=manager)
check("a table in the bin can't be read", s == 404, (s, b))
s, b = call("POST", "/tables", {"name": "Leads", "columns": cols}, manager)
check("its name can be used again while it's in the bin", s == 201, (s, b))
other = b["id"]
s, b = call("POST", f"/tables/{tid}/restore", token=manager)
check("bringing it back is refused while the name is taken", s == 409, (s, b))
call("DELETE", f"/tables/{other}", token=manager)
s, b = call("POST", f"/tables/{tid}/restore", token=manager)
check("then it comes back with its rows", s == 200 and b["rowCount"] == 6, (s, b))
s, b = call("GET", "/tables/bin", token=normal)
check("a normal account can't see the bin", s == 403, (s, b))

print("limits")
lim = call("POST", "/tables", {"name": "Lim", "columns": [{"label": "N", "type": "number"}]}, manager)[1]["id"]
sql(f'UPDATE "UserTables" SET "RowCount" = 99999 WHERE "Id" = {lim}')
s, b = call("POST", f"/tables/{lim}/rows", {"values": {"n": 1}}, manager)
check("row 100,000 is allowed", s == 201, (s, b))
s, b = call("POST", f"/tables/{lim}/rows", {"values": {"n": 2}}, manager)
check("row 100,001 is refused", s == 409 and "100,000" in json.dumps(b), (s, b))
big = call("POST", "/tables", {"name": "Big", "columns": [{"label": f"T{i}", "type": "text", "maxLength": 1000} for i in range(20)]}, manager)[1]["id"]
s, b = call("POST", f"/tables/{big}/rows", {"values": {f"t{i}": "y" * 1000 for i in range(20)}}, manager)
check("a row under 64 KB is fine", s == 201, (s, b))

live = len(call("GET", "/tables", token=manager)[1])
for i in range(live, 49):
    call("POST", "/tables", {"name": f"Fill {i}", "columns": [{"label": "A", "type": "text"}]}, manager)
results = []
def race(n):
    results.append(call("POST", "/tables", {"name": f"Race {n}", "columns": [{"label": "A", "type": "text"}]}, manager)[0])
threads = [threading.Thread(target=race, args=(n,)) for n in range(4)]
for th in threads: th.start()
for th in threads: th.join()
count = len(call("GET", "/tables", token=manager)[1])
check("four people racing for the 50th table: exactly one wins", sorted(results) == [201, 409, 409, 409] and count == 50, (results, count))

print("mirror folder")
time.sleep(4)
files = sorted(os.listdir(MIRROR)) if os.path.isdir(MIRROR) else []
check("each live table has a file", sum(1 for f in files if f.endswith(".json") and f[0].isdigit()) == 50, files[:5])
leads = [f for f in files if f.startswith(f"{tid}-")]
check("the file is named id-name", leads == [f"{tid}-leads.json"], leads)
if leads:
    doc = json.load(open(os.path.join(MIRROR, leads[0]), encoding="utf-8"))
    check("the file has the rows and says it's only a copy", doc["rowCount"] == 6 and len(doc["rows"]) == 6 and "changes nothing" in doc["readMe"], doc.get("rowCount"))
index = json.load(open(os.path.join(MIRROR, "_index.json"), encoding="utf-8"))
check("_index.json lists every table with its size", index["tables"] >= 50 and index["totalBytes"] > 0, index["tables"])
deleted = os.listdir(os.path.join(MIRROR, "deleted"))
check("a table in the bin has its file in deleted/", any(f.startswith(f"{other}-") for f in deleted), deleted)
with open(os.path.join(MIRROR, leads[0]), "w", encoding="utf-8") as f: f.write('{"hand": "edited"}')
s, b = call("GET", f"/tables/{tid}/rows", token=manager)
check("editing a copy by hand changes nothing", s == 200 and b["total"] == 6, (s, b))

print("\n" + (f"{len(fails)} failed" if fails else "TABLES OK"))
sys.exit(1 if fails else 0)
