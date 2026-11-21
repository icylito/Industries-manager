# The five fixes from the stress test, against a throwaway API:
#   1. Browse: an edit made from an old copy of the row is refused, nothing written over
#   2. Scratchpad: a save that never saw the board can't write over it (per board)
#   3. Fields: a rules save without the version it was based on is refused
#   4. Sign in: 429 with Retry-After per address, and per username from any address
#   5. /health: only the state for someone not signed in
#   python3 -I check_fixes.py
# Start the throwaway API with the real sign in limits for part 4: set Auth__LoginTriesPerMinute=5 (the throwaway
# settings allow 100). The API trusts X-Forwarded-For from this PC, which is how this script plays several addresses.
import json, os, secrets, sys, threading, time, urllib.error, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import t
from t import call

fails = []
def check(label, ok, detail=""):
    print(("  ok   " if ok else "  FAIL ") + label + ("" if ok else f"  [{str(detail)[:300]}]"))
    if not ok: fails.append(label)

def send(method, path, body=None, token=None, address=None):
    # Like t.call, plus the answer's headers and a made-up client address
    req = urllib.request.Request(t.BASE + path, data=None if body is None else json.dumps(body).encode(), method=method)
    req.add_header("Content-Type", "application/json")
    if token: req.add_header("Authorization", "Bearer " + token)
    if address: req.add_header("X-Forwarded-For", address)
    try:
        with urllib.request.urlopen(req, timeout=120) as r: status, text, headers = r.status, r.read().decode(), r.headers
    except urllib.error.HTTPError as e: status, text, headers = e.code, e.read().decode(), e.headers
    try: return status, json.loads(text) if text else None, headers
    except ValueError: return status, text, headers

addresses = iter(f"10.{n // 250}.{n % 250}.{secrets.randbelow(250) + 1}" for n in range(100000))

def login(name, password):
    s, b, _ = send("POST", "/auth/login", {"username": name, "password": password}, address=next(addresses))
    assert s == 200, (s, b)
    return b["token"]

def account(admin, role):
    name = f"fix{role[:3]}{secrets.token_hex(3)}"
    s, b, _ = send("POST", "/users", {"username": name, "role": role}, admin)
    assert s == 201, (s, b)
    token = login(name, b["temporaryPassword"])
    new = "Fix-" + secrets.token_urlsafe(14)
    s, b, _ = send("POST", "/auth/password", {"current": b["temporaryPassword"], "new": new}, token, next(addresses))
    assert s < 300, (s, b)
    return name, new

admin = login("admin", t.ADMIN_PASSWORD)

print("1. Browse edits")
stamp = secrets.token_hex(3)
s, row, _ = send("POST", "/industries", {"name": f"Fix row {stamp}", "sector": "Public Sector", "price": 1, "release": None, "extra": {}}, admin)
assert s == 201, (s, row)
rid = row["id"]
seen = {k: row[k] for k in ("name", "sector", "price", "release", "extra")}
def edit(name, price, original):
    body = {"name": name, "sector": "Public Sector", "price": price, "release": None, "extra": {}}
    if original is not None: body["original"] = original
    return send("PUT", f"/industries/update/{rid}", body, admin)
s, b, _ = edit(f"Fix row {stamp} B", 2, seen)
check("tab B saves over the row it saw", s == 204, (s, b))
s, b, _ = edit(f"Fix row {stamp} A", 3, seen)
check("tab A, still holding the old row, is refused with the plain message", s == 409 and "changed this row" in str(b), (s, b))
now = send("GET", f"/industries/{rid}", token=admin)[1]
check("and tab B's change is what's in the table", now["name"] == f"Fix row {stamp} B" and now["price"] == 2, now)
s, b, _ = edit(f"Fix row {stamp} script", 4, None)
check("a save without the old row (a script) still goes through", s == 204, (s, b))
now = send("GET", f"/industries/{rid}", token=admin)[1]
seen = {k: now[k] for k in ("name", "sector", "price", "release", "extra")}
results = []
def racer(n): results.append(edit(f"Fix row {stamp} race {n}", round(1 + n / 10, 1), seen)[0])
threads = [threading.Thread(target=racer, args=(n,)) for n in range(20)]
for th in threads: th.start()
for th in threads: th.join()
check("20 edits from the same copy at once: one saves, 19 are refused", sorted(results) == [204] + [409] * 19, sorted(results))
send("DELETE", f"/industries/{rid}", token=admin)

print("2. Scratchpad")
# Boards are named and several since 2026-10-10, so the guard is per board: see check_scratchpad.py for the rest
s, made, _ = send("POST", "/scratchpad/boards", {"name": "Fixes check"}, admin)
path = f"/scratchpad/boards/{made['id']}"
s, board, _ = send("GET", path, token=admin)
s, b, _ = send("PUT", path, {"document": board["document"], "updatedAt": board["updatedAt"]}, admin)
check("a save from the board as it is goes through", s == 200, (s, b))
current = b["updatedAt"]
s, b, _ = send("PUT", path, {"document": board["document"], "updatedAt": None}, admin)
check("a save from a page that never saw the board is refused", s == 409, (s, b))
s, b, _ = send("PUT", path, {"document": board["document"], "updatedAt": "2020-01-01T00:00:00+00:00"}, admin)
check("a save from an old copy is still refused", s == 409, (s, b))
check("and the board is untouched", send("GET", path, token=admin)[1]["updatedAt"] == current)
send("DELETE", path, token=admin)

print("3. Fields")
s, schema, _ = send("GET", "/schema", token=admin)
s, b, _ = send("PUT", "/schema", {"note": "no version", "fields": schema["fields"]}, admin)
check("a rules save without basedOn is refused", s == 400 and "Reload" in json.dumps(b), (s, b))
s, b, _ = send("POST", "/schema/fields/many", {"fields": [{"label": "Never added", "type": "text", "required": False, "maxLength": 5, "min": None, "max": None}]}, admin)
check("adding fields without basedOn is refused", s == 400, (s, b))
check("and nothing changed", send("GET", "/schema", token=admin)[1]["version"] == schema["version"])
s, b, _ = send("PUT", "/schema", {"note": "stale", "fields": schema["fields"], "basedOn": schema["version"] - 1}, admin)
check("an old basedOn is still a 409", s == 409, (s, b))

print("5. /health")
s, h, _ = send("GET", "/health")
check("not signed in: state and history only", s == 200 and set(h) == {"state", "message", "history"} and h["message"] == "Ready", h)
s, h, _ = send("GET", "/health", token=admin)
check("signed in: the databases and migrations too", "databases" in h and "appliedMigrations" in h, list(h))

print("4. Sign in")
victim, victim_pw = account(admin, "normal")
second, second_pw = account(admin, "normal")
one = f"10.251.{secrets.randbelow(250)}.{secrets.randbelow(250) + 1}"
codes = [send("POST", "/auth/login", {"username": "nobody-" + stamp, "password": "wrong"}, address=one) for _ in range(6)]
check("five tries a minute from one address, the sixth is 429", [c[0] for c in codes] == [401] * 5 + [429], [c[0] for c in codes])
retry = codes[-1][2].get("Retry-After")
check("with Retry-After and the wait in the message", retry is not None and 0 < int(retry) <= 60 and "Try again in" in json.dumps(codes[-1][1]), (retry, codes[-1][1]))

wrong = [send("POST", "/auth/login", {"username": victim, "password": "wrong"}, address=next(addresses))[0] for _ in range(11)]
check("ten wrong passwords for one name from ten addresses, the eleventh is 429", wrong == [401] * 10 + [429], wrong)
s, b, headers = send("POST", "/auth/login", {"username": victim, "password": victim_pw}, address=next(addresses))
check("even the right password waits, so a guess during the wait tells nothing", s == 429 and headers.get("Retry-After"), (s, b))
check("another name isn't held up", send("POST", "/auth/login", {"username": second, "password": second_pw}, address=next(addresses))[0] == 200)

for _ in range(9): send("POST", "/auth/login", {"username": second, "password": "wrong"}, address=next(addresses))
send("POST", "/auth/login", {"username": second, "password": second_pw}, address=next(addresses))
after = [send("POST", "/auth/login", {"username": second, "password": "wrong"}, address=next(addresses))[0] for _ in range(9)]
check("a right password clears the count", after == [401] * 9, after)

print("\n" + (f"{len(fails)} failed" if fails else "FIXES OK"))
sys.exit(1 if fails else 0)
