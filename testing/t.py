# What the checks share: the API client, the throwaway databases and psql.
# API is the throwaway API's address, ADMIN_PASSWORD the admin password the checks sign in with (and set on a first run).
# MAIN_DB and COLLECTOR_DB are the throwaway databases the API in appsettings.Throwaway.example.json makes on 5433.
import json, sys, os, urllib.request, urllib.error, urllib.parse, subprocess
HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.environ.get("API", "http://localhost:5104")
# start.bat's API is on 5005 and 7165. The checks delete rows, so they never talk to it
if urllib.parse.urlparse(BASE).port in (5005, 7165):
    sys.exit(f"API is {BASE}, that's the address start.bat uses. Point API at the throwaway API, see testing/README.md")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD") or sys.exit("Set ADMIN_PASSWORD first, see testing/README.md")
MAIN_DB = os.environ.get("MAIN_DB", "throwaway_main")
COLLECTOR_DB = os.environ.get("COLLECTOR_DB", "throwaway_collector")
# The real databases are never a target, whatever the environment says
if {MAIN_DB, COLLECTOR_DB} & {"main", "collector", "api_v2"}:
    sys.exit("MAIN_DB and COLLECTOR_DB must be throwaway databases, not main, collector or api_v2")
BACKUPS = os.environ.get("BACKUPS", os.path.join(HERE, "throwaway-backups"))
PG_ENV = dict(os.environ, PGPASSWORD="postgres")
TOK = None
def psql(db, q, check=True):
    return subprocess.run(["psql", "-h", "localhost", "-p", "5433", "-U", "postgres", "-d", db, "-qAt", "-c", q],
                          env=PG_ENV, capture_output=True, text=True, check=check).stdout.strip()
def call(method, path, body=None, token=None, raw=False):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if data is not None: req.add_header("Content-Type", "application/json")
    t = token or TOK
    if t: req.add_header("Authorization", "Bearer " + t)
    try:
        with urllib.request.urlopen(req, timeout=900) as r:
            text = r.read().decode()
            if raw: return r.status, text
            try: return r.status, (json.loads(text) if text else None)
            except ValueError: return r.status, text
    except urllib.error.HTTPError as e:
        text = e.read().decode()
        try: return e.code, json.loads(text)
        except Exception: return e.code, text
def login(user, pw):
    s, b = call("POST", "/auth/login", {"username": user, "password": pw})
    assert s == 200, (s, b)
    return b["token"], b["user"]
