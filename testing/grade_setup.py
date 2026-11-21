import sys, os, json, shutil, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import t
from t import call
PW0 = sys.argv[1]
tok, user = t.login("admin", PW0); t.TOK = tok
if user["mustChangePassword"]:
    s, b = call("POST", "/auth/password", {"current": PW0, "new": t.ADMIN_PASSWORD}); assert s == 200, b
    t.TOK, _ = t.login("admin", t.ADMIN_PASSWORD)
# 300 rows, one of them long
names = [f"Seed Company {i:03d}" for i in range(299)] + ["Horizon Water and Desalination Holdings LLC"]
for i, n in enumerate(names):
    s, b = call("POST", "/industries", {"name": n, "sector": "Public Sector" if i % 2 else "Private Sector", "price": round((i % 90) / 10, 2), "release": "2021-05-04" if i % 3 else None, "extra": {}}); assert s == 201, b
# a custom field with a value in 12 rows
s, b = call("POST", "/schema/fields", {"label": "Ticker", "type": "text", "required": False, "maxLength": 10, "min": None, "max": None}); assert s == 200, b
s, rows = call("GET", "/industries")
for r in rows[:12]:
    s, b = call("PUT", f"/industries/update/{r['id']}", {"name": r["name"], "sector": r["sector"], "price": r["price"], "release": r["release"], "extra": {"ticker": "T" + str(r["id"])}}); assert s == 204, b
# an amber row: bring back a saved version so copies of existing names land flagged
s, versions = call("GET", "/history/versions"); vid = versions[0]["id"]
s, b = call("POST", f"/history/versions/{vid}/import", {"confirm": True, "skipDuplicates": False}); assert s == 200, b
s, rows = call("GET", "/industries"); amber = [r for r in rows if r["duplicateOf"] is not None]
# keep exactly 300 rows: drop the extra flagged copies except 2 amber ones
for r in amber[2:]:
    s, b = call("DELETE", f"/industries/{r['id']}"); assert s == 200, b
s, rows = call("GET", "/industries")
while len(rows) > 300:
    r = next(x for x in rows if x["duplicateOf"] is None and x["name"].startswith("Seed Company") and not (x.get("extra") or {}).get("ticker")); s, b = call("DELETE", f"/industries/{r['id']}"); assert s == 200, b
    s, rows = call("GET", "/industries")
print("rows", len(rows), "amber", sum(1 for r in rows if r["duplicateOf"] is not None), "with ticker", sum(1 for r in rows if (r.get("extra") or {}).get("ticker")))
s, bk = call("POST", "/backups", {}); assert s == 200, bk; print("backup", bk["id"], "rows", bk["rowCount"])
# another layout
folder = t.BACKUPS; other = os.path.join(folder, bk["id"][:-7] + "_nightly" if bk["id"].endswith("_manual") else bk["id"].replace("_nightly", "_manual"))
shutil.copytree(os.path.join(folder, bk["id"]), other)
j = json.load(open(os.path.join(other, "backup.json"))); j["migrations"] = j["migrations"][:-1]; j["createdAt"] = "2026-10-01T02:00:00+00:00"; json.dump(j, open(os.path.join(other, "backup.json"), "w"))
# 20 rows gone after the backup, none of them the long one, the amber ones or the ticker ones
gone = 0
for r in rows:
    if gone == 20: break
    if r["duplicateOf"] is None and r["name"].startswith("Seed Company 2") and not (r.get("extra") or {}).get("ticker"):
        s, b = call("DELETE", f"/industries/{r['id']}"); assert s == 200, b; gone += 1
s, rows = call("GET", "/industries"); print("rows now", len(rows))
json.dump({"backup": bk["id"], "other": os.path.basename(other), "long": "Horizon Water and Desalination Holdings LLC"}, open(os.path.join(t.BACKUPS, "grade.json"), "w"))
print("SETUP OK")
