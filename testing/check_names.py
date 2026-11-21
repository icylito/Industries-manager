# The one name rule (backend/Domain/Rules/Names.cs): two names are the same when they match ignoring capital letters, accents,
# spaces, punctuation and symbols, by ICU. Checked on the throwaway API for everything with a name: companies, tables
# and their columns, fields and accounts. The rule lives in three places (the database's collation name_rule, C#'s
# Names, the page's domain/name-key.ts); each is held to the same examples below, the page's in name-key.spec.ts.
#   python3 -I check_names.py      with the throwaway API running, ADMIN_PASSWORD set
import json, os, sys, uuid
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

# The same pairs as angular/src/app/domain/name-key.spec.ts: (a, b, one name?)
PAIRS = [("Acme, Inc.", "acme-inc", True), ("Ácmé Inc", "ACME inc", True), ("ali.k", "ali_k", True), ("काम", "कम", False),
         ("ΟΔΟΣ", "οδος", True), ("İzmir", "izmir", True), ("Acme 1", "Acme 2", False), ("Sales 2", "sales. (2)", True),
         ("شركة", "شَرِكة", True), ("Ｆｕｌｌ", "full", True), ("a+b", "ab", True), ("$Cash", "cash", True),
         ("𠀀𠀁", "𠀀𠀂", False), ("Café", "Cafe", True), ("straße", "strasse", True), ("Zero​Width", "zerowidth", True)]
quote = lambda s: "'" + s.replace("'", "''") + "'"
col = lambda label: {"label": label, "type": "text", "required": False, "maxLength": 20, "min": None, "max": None, "options": []}

print("1. The database and the API agree on the same examples")
for n, (a, b, same) in enumerate(PAIRS):
    db = pg.sql(t.MAIN_DB, f"SELECT {quote(a)} = {quote(b)} COLLATE name_rule") == "t"
    # Column names are compared in C#: a table with both as columns is refused exactly when they are one name
    s, body = t.call("POST", "/tables", {"name": f"Pair {stamp} {n}", "columns": [col(a), col(b)]})
    api = s == 400
    if s in (200, 201): t.call("DELETE", f"/tables/{body['id']}")
    check(f"{a!r} and {b!r}: {'one name' if same else 'two names'}", db == same and api == same, {"database": db, "api": api, "expected": same})

print("\n2. Companies")
add = lambda name: t.call("POST", "/industries", {"name": name, "sector": "Public Sector", "price": 1, "release": None, "extra": {}})
s, b = add(f"Rule Co {stamp}.")
check("a new company is added", s == 201, (s, b))
first = b["id"] if s == 201 else None
for twin in (f"rule co {stamp}", f"RULE-CO {stamp}!", f"Rúle Có {stamp}", f"$rule co {stamp}"):
    s, b = add(twin)
    check(f"{twin!r} is the same name and refused", s == 409, (s, b))
s, b = add("!!!")
check("a name of only symbols is refused, in plain words", s == 400 and "letter or digit" in str(b), (s, b))
s, b = add(f"काम {stamp}")
s2, b2 = add(f"कम {stamp}")
check("two Hindi words that differ by a vowel sign are two companies", s == 201 and s2 == 201, (s, s2))
extra_rows = [x["id"] for x in (b, b2) if isinstance(x, dict) and "id" in x]
s, b = add(f"Rule Co {stamp} 2")
check("a different number is a different name", s == 201, (s, b))
second = b["id"] if s == 201 else None
if second:
    s, b = t.call("PUT", f"/industries/update/{second}", {"name": f"rule co {stamp}", "sector": "Public Sector", "price": 1, "release": None, "extra": {}})
    check("renaming one to the first's name by the rule is refused", s == 409, (s, b))

print("\n3. A History version holding two names the rule calls one can still be restored")
# A version is saved before every change of the Fields; one row of it is then given a name the old rule allowed
s, b = t.call("POST", "/schema/fields", {"label": f"Version mark {stamp}", "type": "text", "required": False, "maxLength": 10, "min": None, "max": None})
s, versions = t.call("GET", "/history/versions")
version = versions[0]["id"]
if first and second:
    pg.sql(t.COLLECTOR_DB, f"""UPDATE version_rows SET data = jsonb_set(data, '{{Name}}', '"rule-co {stamp}"')
                              WHERE version_id = {version} AND row_id = {second}""")
    s, b = t.call("POST", f"/history/versions/{version}/restore", {"note": "check_names: a version with two names the rule calls one"})
    check("the restore goes through", s == 200, (s, b))
    flag = pg.sql(t.MAIN_DB, f"""SELECT coalesce("DuplicateOf"::text, 'none') FROM "Industries" WHERE "Id" = {second}""")
    check("and the later of the two comes back as a copy of the first", flag == str(first), flag)
# The fields this check, or an older run of it, made
s, schema = t.call("GET", "/schema")
for label in [f["label"] for f in schema["fields"] if f["label"].startswith(("Version mark", "Ticker", "Measure note"))]:
    s, schema = t.call("GET", "/schema")
    key = next(f["key"] for f in schema["fields"] if f["label"] == label)
    t.call("DELETE", f"/schema/fields/{key}?basedOn={schema['version']}")
for row in (first, second, *extra_rows):
    if row: t.call("DELETE", f"/industries/{row}")

print("\n4. Tables and their columns")
s, b = t.call("POST", "/tables", {"name": f"Rule Table {stamp}", "columns": [col("Price")]})
check("a new table is made", s in (200, 201), (s, b))
table = b.get("id") if isinstance(b, dict) else None
s, b = t.call("POST", "/tables", {"name": f"rule-table {stamp}!", "columns": [col("Price")]})
check("a table with the same name by the rule is refused", s == 409, (s, b))
s, b = t.call("POST", "/tables", {"name": "...", "columns": [col("Price")]})
check("a table name of only symbols is refused", s == 400 and "letter or digit" in str(b), (s, b))
if table: t.call("DELETE", f"/tables/{table}")

print("\n5. Fields")
s, b = t.call("POST", "/schema/fields", {"label": f"Ticker {stamp}", "type": "text", "required": False, "maxLength": 10, "min": None, "max": None})
check("a new field is added", s == 200, (s, b))
s, b = t.call("POST", "/schema/fields", {"label": f"ticker-{stamp}!", "type": "text", "required": False, "maxLength": 10, "min": None, "max": None})
check("a field with the same label by the rule is refused", s == 400 and "already exists" in str(b), (s, b))
s, schema = t.call("GET", "/schema")
key = next((f["key"] for f in schema["fields"] if f["label"] == f"Ticker {stamp}"), None)
if key:
    s, b = t.call("DELETE", f"/schema/fields/{key}?basedOn={schema['version']}")
    check("and it is removed again, leaving nothing behind", s == 200, (s, b))

print("\n6. Accounts")
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
