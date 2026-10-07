# History goes away after startup and comes back: /health, the History routes and adds must follow it
import sys, os, time, subprocess
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import t
from t import call
t.TOK, _ = t.login("admin", t.ADMIN_PASSWORD)
def admin(q): return t.psql("postgres", q)
DB, OFF = t.COLLECTOR_DB, t.COLLECTOR_DB + "_off"

s, h = call("GET", "/health"); assert h["history"]["ready"], h
# take the collector away under the running API
admin(f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{DB}'")
admin(f'ALTER DATABASE "{DB}" RENAME TO "{OFF}"')
try:
    # a write notices right away and marks history down
    s, b = call("POST", "/industries", {"name": f"While history is off {int(time.time())}", "sector": "Public Sector", "price": 1, "release": None, "extra": {}})
    print("add while history is off:", s, b.get("detail") if isinstance(b, dict) else b); assert s == 503
    s, h = call("GET", "/health"); print("health right after the failed add:", h["history"]); assert h["history"]["ready"] is False
    s, b = call("GET", "/history/versions"); print("history list:", s, b.get("detail") if isinstance(b, dict) else b); assert s == 503
    s, rows = call("GET", "/industries"); assert s == 200 and len(rows) > 0, "the table itself must still be readable"
    # a backup restore refuses before touching anything
    s, lst = call("GET", "/backups"); bid = lst["backups"][0]["id"]
    s, b = call("POST", f"/backups/{bid}/restore", {"confirm": "RESTORE"}); print("restore while history is off:", s, b.get("detail")); assert s == 503
finally:
    admin(f'ALTER DATABASE "{OFF}" RENAME TO "{DB}"')
# the monitor brings it back within its 30 second check
for i in range(14):
    time.sleep(5)
    s, h = call("GET", "/health")
    if h["history"]["ready"]: break
print(f"history back after about {(i+1)*5}s:", h["history"]); assert h["history"]["ready"]
s, b = call("GET", "/history/versions"); assert s == 200
s, b = call("POST", "/industries", {"name": f"After history is back {int(time.time())}", "sector": "Public Sector", "price": 1, "release": None, "extra": {}}); assert s == 201, b
call("DELETE", f"/industries/{b['id']}")
print("MONITOR OK")
