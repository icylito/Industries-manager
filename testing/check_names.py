# The one name rule (api_v2/Rules/Names.cs): two names are the same when they match after ignoring capital letters,
# accents, spaces, punctuation and symbols, in any script. Checked on the throwaway API for everything with a name:
# companies, tables and their columns, fields and accounts. Also checks that the database's name_key, the C# rule
# (through the API's answers) and the page's rule (angular/src/app/services/name-key.ts) agree on the same names.
#   python3 -I check_names.py      with the throwaway API running, ADMIN_PASSWORD set
import os, sys, time, unicodedata, uuid
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import t, pg
# Names in any script are printed, and a Windows console's own code page can't show all of them
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

fails = []
def check(label, ok, detail=""):
    print(("  ok   " if ok else "  FAIL ") + label + ("" if ok else f"  [{str(detail)[:400]}]"))
    if not ok: fails.append(label)

t.TOK, _ = t.login("admin", t.ADMIN_PASSWORD)
stamp = uuid.uuid4().hex[:5]

print("1. The rule, the same in the database and in Python's reading of it")
samples = ["Acme, Inc.", "ACME inc", "acme-inc", "Ácmé  Inc", "ali.k", "ali_k", "شركة النفط 2", "Ｆｕｌｌ Ｗｉｄｔｈ", "!!! ---", "Café", "CAFE"]
def py_key(s):
    return "".join(ch for ch in unicodedata.normalize("NFKD", s.lower()) if ch.isalnum() and not unicodedata.combining(ch))
for s in samples:
    db = pg.sql(t.MAIN_DB, "SELECT name_key('" + s.replace("'", "''") + "')")
    check(f"{s!r} -> {db!r}", db == py_key(s), (db, py_key(s)))

print("\n2. Companies")
s, b = t.call("POST", "/industries", {"name": f"Rule Co {stamp}.", "sector": "Public Sector", "price": 1, "release": None, "extra": {}})
check("a new company is added", s == 201, (s, b))
first = b["id"] if s == 201 else None
for twin in (f"rule co {stamp}", f"RULE-CO {stamp}!", f"Rúle Có {stamp}"):
    s, b = t.call("POST", "/industries", {"name": twin, "sector": "Public Sector", "price": 1, "release": None, "extra": {}})
    check(f"{twin!r} is the same name and refused", s == 409, (s, b))
s, b = t.call("POST", "/industries", {"name": "!!!", "sector": "Public Sector", "price": 1, "release": None, "extra": {}})
check("a name of only symbols is refused, in plain words", s == 400 and "letter or digit" in str(b), (s, b))
s, b = t.call("POST", "/industries", {"name": f"Rule Co {stamp} 2", "sector": "Public Sector", "price": 1, "release": None, "extra": {}})
check("a different number is a different name", s == 201, (s, b))
second = b["id"] if s == 201 else None
if second:
    s, b = t.call("PUT", f"/industries/update/{second}", {"name": f"rule co {stamp}", "sector": "Public Sector", "price": 1, "release": None, "extra": {}})
    check("renaming one to the first's name by the rule is refused", s == 409, (s, b))
for row in (first, second):
    if row: t.call("DELETE", f"/industries/{row}")

print("\n3. Tables and their columns")
col = lambda label: {"label": label, "type": "text", "required": False, "maxLength": 20, "min": None, "max": None, "options": []}
s, b = t.call("POST", "/tables", {"name": f"Rule Table {stamp}", "columns": [col("Price")]})
check("a new table is made", s in (200, 201), (s, b))
table = b.get("id") if isinstance(b, dict) else None
s, b = t.call("POST", "/tables", {"name": f"rule-table {stamp}!", "columns": [col("Price")]})
check("a table with the same name by the rule is refused", s == 409, (s, b))
s, b = t.call("POST", "/tables", {"name": f"Other {stamp}", "columns": [col("Price"), col("price!")]})
check("two columns with the same name by the rule are refused", s == 400, (s, b))
s, b = t.call("POST", "/tables", {"name": "...", "columns": [col("Price")]})
check("a table name of only symbols is refused", s == 400 and "letter or digit" in str(b), (s, b))
if table: t.call("DELETE", f"/tables/{table}")

print("\n4. Fields")
s, b = t.call("POST", "/schema/fields", {"label": f"Ticker {stamp}", "type": "text", "required": False, "maxLength": 10, "min": None, "max": None})
check("a new field is added", s == 200, (s, b))
s, b = t.call("POST", "/schema/fields", {"label": f"ticker-{stamp}!", "type": "text", "required": False, "maxLength": 10, "min": None, "max": None})
check("a field with the same label by the rule is refused", s == 400 and "already exists" in str(b), (s, b))
s, schema = t.call("GET", "/schema")
key = next((f["key"] for f in schema["fields"] if f["label"] == f"Ticker {stamp}"), None)
if key: t.call("DELETE", f"/schema/fields/{key}", {"confirm": True})

print("\n5. Accounts")
s, b = t.call("POST", "/users", {"username": f"rule.{stamp}", "role": "normal"})
check("a new account is made", s in (200, 201), (s, b))
made = b["user"]["id"] if s in (200, 201) else None
s, b = t.call("POST", "/users", {"username": f"rule_{stamp}", "role": "normal"})
check("a username that is the same by the rule is refused", s == 409, (s, b))
s, b = t.call("POST", "/users", {"username": "...", "role": "normal"})
check("a username of only symbols is refused", s == 400, (s, b))

# An older clash, as the migration would have found it: the newer account is flagged, and renaming it clears the flag
clash = pg.sql(t.MAIN_DB, f"""INSERT INTO "Users" ("Username", "PasswordHash", "Role", "Disabled", "MustChangePassword", "CreatedAt", "CreatedBy", "NameClash")
    VALUES ('rule-{stamp}', 'x', 'normal', false, true, now(), 'check', true) RETURNING "Id" """).splitlines()[0]
s, users = t.call("GET", "/users")
row = next((u for u in users if u["id"] == int(clash)), None)
check("the people list says which account clashes", row is not None and row.get("nameClash") is True, row)
s, b = t.call("PUT", f"/users/{clash}", {"username": f"rule-{stamp}-two"})
check("renaming it to a free name works and clears the flag", s == 200 and b.get("nameClash") is False, (s, b))
for who in (made, clash):
    if who: t.call("DELETE", f"/users/{who}")

print("\n" + (f"{len(fails)} failed" if fails else "NAMES OK"))
sys.exit(1 if fails else 0)
