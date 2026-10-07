import sys, json, time, random, shutil, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import t
from t import call
# First run: python3 -I check_restore.py <password from the API window>. It picks Admin-pass-2026! (or ADMIN_PASSWORD) and later runs use that.
PW0 = sys.argv[1]
ADMIN_PW = t.ADMIN_PASSWORD
# 1. first sign in and the forced password change
tok, user = t.login("admin", PW0) if len(sys.argv) < 3 else t.login("admin", ADMIN_PW)
t.TOK = tok
if user["mustChangePassword"]:
    s, b = call("POST", "/auth/password", {"current": PW0, "new": ADMIN_PW}); assert s == 200, b
    tok, user = t.login("admin", ADMIN_PW); t.TOK = tok
print("signed in as", user["username"])

# 2. seed 300 rows
s, rows = call("GET", "/industries")
if len(rows) < 300:
    stamp = int(time.time())
    for i in range(300 - len(rows)):
        s, b = call("POST", "/industries", {"name": f"Seed Company {stamp} {i:03d}", "sector": random.choice(["Public Sector", "Private Sector"]),
                                             "price": round(random.uniform(0, 10), 2), "release": "2020-01-01", "extra": {}})
        assert s == 201, (s, b)
s, rows = call("GET", "/industries"); n0 = len(rows); print("rows before backup", n0)
s, schema = call("GET", "/schema"); v0 = schema["version"]; print("rules version before backup", v0)
s, retention0 = call("GET", "/history/settings")

# a second account and a request, both must survive the restore differently
s, bob = call("POST", "/users", {"username": "bob", "role": "normal"}); assert s in (201, 409), (s, bob)
s, req = call("POST", "/requests", {"title": "Keep me", "details": "made before the backup"}); assert s in (200, 201), (s, req)

# 3. back up
s, bk = call("POST", "/backups", {}); assert s == 200, (s, bk); bid = bk["id"]
print("backup", bid, "rows recorded", bk["rowCount"], "sameLayout", bk["sameLayout"])

# 4. change things after the backup
for r in rows[:20]:
    s, b = call("DELETE", f"/industries/{r['id']}"); assert s == 200, (s, b)
s, b = call("POST", "/industries", {"name": "Added After Backup", "sector": "Public Sector", "price": 1, "release": None, "extra": {}}); assert s == 201, b
s, b = call("POST", "/schema/fields", {"label": "Ticker", "type": "text", "required": False, "maxLength": 10, "min": None, "max": None}); assert s == 200, b
s, b = call("POST", "/requests", {"title": "Made after the backup", "details": "should vanish"}); assert s == 201, b
s, b = call("PUT", "/history/settings", {"keepVersions": 77, "keepDays": None}); assert s == 200, b
s, carol = call("POST", "/users", {"username": "carol", "role": "admin"}); assert s in (201, 409), carol
s, users_before = call("GET", "/users")
s, rows_mid = call("GET", "/industries"); print("rows after changes", len(rows_mid))
s, schema = call("GET", "/schema"); print("rules version after changes", schema["version"], [f["key"] for f in schema["fields"]])
s, versions_mid = call("GET", "/history/versions")

# 5. preview and restore
s, pv = call("GET", f"/backups/{bid}/restore/preview"); print("preview", s, pv)
s, b = call("POST", f"/backups/{bid}/restore", {"confirm": "nope"}); assert s == 400, (s, b)
t0 = time.time()
s, res = call("POST", f"/backups/{bid}/restore", {"confirm": "RESTORE"}); print("restore", s, res, f"{time.time()-t0:.1f}s"); assert s == 200

# 6. verify
s, rows_after = call("GET", "/industries"); assert len(rows_after) == n0, (len(rows_after), n0)
assert not any(r["name"] == "Added After Backup" for r in rows_after)
s, schema = call("GET", "/schema"); assert schema["version"] == v0 and all(f["key"] != "ticker" for f in schema["fields"]), schema
s, reqs = call("GET", "/requests", None); titles = [r["title"] for r in reqs]; assert "Keep me" in titles and "Made after the backup" not in titles, titles
s, ret = call("GET", "/history/settings"); assert ret == retention0, (ret, retention0)
s, users_after = call("GET", "/users"); assert [u["username"] for u in users_after] == [u["username"] for u in users_before], (users_before, users_after)
assert any(u["username"] == "carol" for u in users_after), "carol made after the backup must still exist"
s, me = call("GET", "/auth/me"); assert s == 200, "the admin token must still work"
s, versions = call("GET", "/history/versions"); assert versions[0]["reason"] == f"Before restoring backup {bid}", versions[0]
assert len(versions) == len(versions_mid) + 1
# a new row gets an id above the restored ones
s, b = call("POST", "/industries", {"name": "After Restore", "sector": "Public Sector", "price": 1, "release": None, "extra": {}}); assert s == 201, b
assert b["id"] > max(r["id"] for r in rows_after), b
call("DELETE", f"/industries/{b['id']}")
print("RESTORE OK: rows, rules, requests and settings back; users, sessions kept; copy saved first")

# 7. a backup from another layout is refused before anything changes
folder = os.environ.get("BACKUPS", "/var/tmp/apitest/backups")
fake = os.path.join(folder, bid[:-7] + "_manual") if bid.endswith("nightly") else os.path.join(folder, bid.replace("_manual", "_nightly"))
shutil.copytree(os.path.join(folder, bid), fake)
j = json.load(open(os.path.join(fake, "backup.json"))); j["migrations"] = j["migrations"][:-1]; json.dump(j, open(os.path.join(fake, "backup.json"), "w"))
s, b = call("POST", f"/backups/{os.path.basename(fake)}/restore", {"confirm": "RESTORE"}); print("other layout", s, b); assert s == 409
s, lst = call("GET", "/backups"); print("list sameLayout flags", [(x["id"][-7:], x["sameLayout"]) for x in lst["backups"]])
shutil.rmtree(fake)

# 8. a damaged dump is refused, the table is unchanged and no copy is left behind
shutil.copytree(os.path.join(folder, bid), fake)
open(os.path.join(fake, "main.dump"), "r+b").write(b"garbage garbage garbage")
s, vcount = call("GET", "/history/versions")
s, b = call("POST", f"/backups/{os.path.basename(fake)}/restore", {"confirm": "RESTORE"}); print("damaged dump", s, b); assert s == 503
s, rows_x = call("GET", "/industries"); assert len(rows_x) == n0
s, vcount2 = call("GET", "/history/versions"); assert len(vcount2) == len(vcount), "no copy may be left behind"
shutil.rmtree(fake)
print("REFUSALS OK")
