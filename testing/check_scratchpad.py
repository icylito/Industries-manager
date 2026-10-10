# The Scratchpad's API, round 2026-10-10: named boards, the board rules, the carry tray, a person's own settings
# and the file sweep. Throwaway only, like the other checks.
#   python3 -I check_scratchpad.py
# Start the throwaway API with Scratchpad__SweepMinutes=1 (and Scratchpad__Files pointing into testing/throwaway-backups)
# so the sweep part doesn't wait an hour. Makes its own second admin, to check one person can't reach another's boards.
import os, re, sys, time, uuid, urllib.request, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shutil, subprocess
import t

# psql on this PC if there is one, otherwise the one in the database container
def psql(db, q):
    if shutil.which("psql"): return t.psql(db, q)
    return subprocess.run(["docker", "exec", "stock-listing-db", "psql", "-U", "postgres", "-d", db, "-qAt", "-c", q],
                          capture_output=True, text=True, check=True).stdout.strip()

fails = []
def check(label, ok, detail=""):
    print(("  ok   " if ok else "  FAIL ") + label + ("" if ok else f"  [{str(detail)[:400]}]"))
    if not ok: fails.append(label)

def send(method, path, body=None, token=None):
    return t.call(method, path, body, token)

admin, me = t.login("admin", t.ADMIN_PASSWORD)
EMPTY = {"version": 1, "items": [], "lines": [], "groups": []}
note = lambda i, **extra: {"id": i, "type": "note", "x": 0, "y": 0, "w": 250, "h": 150, "tone": "white", "tilt": 0,
                           "blocks": [{"id": "b" + i, "list": "none", "runs": [{"text": "hi"}]}], **extra}

print("1. Named boards")
s, made = send("POST", "/scratchpad/boards", {"name": "  Energy story  "}, admin)
check("a new board is made with its name trimmed", s == 201 and made["name"] == "Energy story", (s, made))
board = made["id"]
s, got = send("GET", f"/scratchpad/boards/{board}", token=admin)
check("it opens empty, with no view yet", s == 200 and got["document"]["items"] == [] and got["view"] is None, got)
stamp = got["updatedAt"]
s, saved = send("PUT", f"/scratchpad/boards/{board}", {"document": {**EMPTY, "items": [note("a")]}, "updatedAt": stamp}, admin)
check("a save from the page that read it goes through", s == 200, (s, saved))
s, b = send("PUT", f"/scratchpad/boards/{board}", {"document": EMPTY, "updatedAt": stamp}, admin)
check("a save from a stale tab is refused with 409", s == 409, (s, b))
s, b = send("PATCH", f"/scratchpad/boards/{board}", {"name": "Energy, part 2", "pinned": True, "view": {"x": 5, "y": 1e12, "zoom": 99}}, admin)
check("rename and pin in one call", s == 200 and b["name"] == "Energy, part 2" and b["pinned"] is True, (s, b))
s, got = send("GET", f"/scratchpad/boards/{board}", token=admin)
check("the view is kept and tidied (zoom to 4, far off place brought back)", got["view"]["zoom"] == 4 and abs(got["view"]["y"]) <= 4e6, got["view"])
check("renaming, pinning and moving the view leave updatedAt alone, so the open tab can still save",
      got["updatedAt"] == saved["updatedAt"], (got["updatedAt"], saved["updatedAt"]))
s, b = send("PATCH", f"/scratchpad/boards/{board}", {"name": "n" * 61}, admin)
check("a name over 60 characters is refused, not cut", s == 400, (s, b))
s, b = send("POST", "/scratchpad/boards", {"name": "n" * 61}, admin)
check("on a new board too", s == 400, (s, b))
s, b = send("PATCH", f"/scratchpad/boards/{board}", {"name": "n" * 60}, admin)
check("60 is fine", s == 200 and b["name"] == "n" * 60, (s, b))
send("PATCH", f"/scratchpad/boards/{board}", {"name": "Energy, part 2"}, admin)
s, b = send("DELETE", f"/scratchpad/boards/{board}", token=admin)
check("a pinned board can't be deleted", s == 409, (s, b))
s, rows = send("GET", "/scratchpad/boards", token=admin)
mine = [r for r in rows if r["id"] == board]
check("the list has it first among pinned, with its count", mine and mine[0]["things"] == 1 and rows[0]["pinned"], rows[:3])
s, copy = send("POST", "/scratchpad/boards", {"name": "Copy", "document": {**EMPTY, "items": [note("a"), note("b")]}}, admin)
check("a new board can start as a copy of a document (Keep mine as a new board)", s == 201 and copy["things"] == 2, copy)
s, b = send("POST", "/scratchpad/boards", {"name": "", "document": {"version": 2, "items": []}}, admin)
check("a copy that breaks the rules is refused", s == 400, (s, b))

print("\n2. Someone else's boards")
other_name = "check" + uuid.uuid4().hex[:6]
s, made_user = send("POST", "/users", {"username": other_name, "role": "admin"}, admin)
if s in (200, 201):
    temp = made_user["temporaryPassword"]
    other, _ = t.login(other_name, temp)
    send("POST", "/auth/password", {"current": temp, "new": "Another-one-2026!"}, other)
    other, _ = t.login(other_name, "Another-one-2026!")
    for method, body in (("GET", None), ("PUT", {"document": EMPTY, "updatedAt": stamp}), ("PATCH", {"name": "mine now"}), ("DELETE", None)):
        s, b = send(method, f"/scratchpad/boards/{board}", body, other)
        check(f"{method} on another person's board answers 404", s == 404, (s, b))
    s, rows = send("GET", "/scratchpad/boards", token=other)
    check("their list doesn't show it", all(r["id"] != board for r in rows), rows)
    s, b = send("DELETE", f"/users/{made_user['user']['id']}", token=admin)
    check("the second account is deleted again", s in (200, 204), (s, b))
else:
    print(f"  (couldn't make a second account: {s} {made_user}, skipped)")

print("\n3. The board rules")
def save(doc):
    s, now = send("GET", f"/scratchpad/boards/{copy['id']}", token=admin)
    return send("PUT", f"/scratchpad/boards/{copy['id']}", {"document": doc, "updatedAt": now["updatedAt"]}, admin)
stroke = lambda n, i="s": {"id": i, "type": "stroke", "kind": "pen", "x": 0, "y": 0, "w": 10, "h": 10, "points": [1.5] * (n * 2)}
cases = [
    ("a pen stroke", {**EMPTY, "items": [stroke(50)]}, 200),
    ("a drawn box", {**EMPTY, "items": [{"id": "r", "type": "rect", "x": 0, "y": 0, "w": 100, "h": 80, "tone": "amber"}]}, 200),
    ("a stroke over 2000 points", {**EMPTY, "items": [stroke(2001)]}, 400),
    ("over 50,000 points on one board", {**EMPTY, "items": [stroke(2000, f"s{i}") for i in range(26)]}, 400),
    ("a stroke with an odd number of values", {**EMPTY, "items": [{**stroke(3), "points": [1, 2, 3]}]}, 400),
    ("a box in a colour the page doesn't know", {**EMPTY, "items": [{"id": "r", "type": "rect", "x": 0, "y": 0, "w": 1, "h": 1, "tone": "plaid"}]}, 400),
    ("a thing of a kind the page doesn't know", {**EMPTY, "items": [{"id": "z", "type": "hologram", "x": 0, "y": 0, "w": 1, "h": 1}]}, 400),
    ("two things with one id", {**EMPTY, "items": [note("a"), note("a")]}, 400),
    ("a thing a million and one units away", {**EMPTY, "items": [note("a", x=1_000_001)]}, 400),
    ("a line to something not on the board", {**EMPTY, "items": [note("a")], "lines": [{"id": "l", "from": "a", "to": "gone", "head": "end", "bend": 0, "label": ""}]}, 400),
    ("a line with a 201 character label", {**EMPTY, "items": [note("a"), note("b")], "lines": [{"id": "l", "from": "a", "to": "b", "head": "end", "bend": 0, "label": "x" * 201}]}, 400),
    ("a group of one", {**EMPTY, "items": [note("a")], "groups": [{"id": "g", "name": "", "itemIds": ["a"]}]}, 400),
    ("a thing in two groups", {**EMPTY, "items": [note("a"), note("b"), note("c")], "groups": [
        {"id": "g", "name": "", "itemIds": ["a", "b"]}, {"id": "h", "name": "", "itemIds": ["b", "c"]}]}, 400),
    ("a note over 10,000 characters across its runs", {**EMPTY, "items": [note("a", blocks=[{"id": "x", "list": "none", "runs": [{"text": "y" * 6000}, {"text": "y" * 5000}]}])]}, 400),
    ("a note in a font from the list", {**EMPTY, "items": [note("a", blocks=[{"id": "x", "list": "none", "runs": [{"text": "y", "font": "Caveat"}]}])]}, 200),
    ("a note in a font the list doesn't offer", {**EMPTY, "items": [note("a", blocks=[{"id": "x", "list": "none", "runs": [{"text": "y", "font": "Wingdings Pro"}]}])]}, 400),
    ("a thing 0 wide", {**EMPTY, "items": [note("a", w=0)]}, 400),
    ("a thing 0 high", {**EMPTY, "items": [note("a", h=0)]}, 400),
    ("a note in a font name with odd characters", {**EMPTY, "items": [note("a", blocks=[{"id": "x", "list": "none", "runs": [{"text": "y", "font": "Inter;<x>"}]}])]}, 400),
]
for label, doc, want in cases:
    s, b = save(doc)
    check(f"{label}: {want}", s == want, (s, b))
s, _ = save({**EMPTY, "items": [note("a")], "view": {"x": 1, "y": 1, "zoom": 1}, "tray": [{"id": "x"}]})
s, now = send("GET", f"/scratchpad/boards/{copy['id']}", token=admin)
check("a view or a tray sent inside a board is dropped, they live apart", "view" not in now["document"] and "tray" not in now["document"], now["document"].keys())

print("\n4. The carry tray")
snap = lambda i: {"id": i, "kind": "list", "title": "Top 3 most expensive: All industries", "takenAt": "2026-10-10T09:00:00Z",
                  "numbers": [{"label": "Alpha", "value": "$9.000"}], "split": "sector", "pick": None}
for i in range(22):
    s, tray = send("POST", "/scratchpad/tray", snap(f"t{i}"), admin)
check("carrying answers with the tray, kept to the newest 20", s == 200 and len(tray["items"]) == 20 and tray["items"][0]["id"] == "t2", len(tray["items"]))
s, tray = send("POST", "/scratchpad/tray", snap("t5"), admin)
check("carrying the same snapshot again moves it to the end, never twice", [x["id"] for x in tray["items"]].count("t5") == 1 and tray["items"][-1]["id"] == "t5")
s, tray = send("DELETE", "/scratchpad/tray/t5", token=admin)
check("taking one out", s == 200 and all(x["id"] != "t5" for x in tray["items"]))
s, b = send("POST", "/scratchpad/tray", {"id": "bad", "kind": "pie", "title": "x", "takenAt": "", "numbers": []}, admin)
check("a snapshot of a kind the page doesn't know is refused", s == 400, (s, b))

print("\n5. A person's own settings")
s, b = send("PUT", "/me/settings", {"shortcuts": {"ov.find": ["Q"], "sp.pen": ["Q"]}, "mouse": {}, "theme": None}, admin)
check("one key on two different pages is fine", s == 200, (s, b))
s, b = send("PUT", "/me/settings", {"shortcuts": {"sp.select": ["X"], "nav.overview": ["G", "V"], "sp.hand": []}, "mouse": {"mouse.dup": "Shift", "mouse.add": "Alt"}, "theme": "dark"}, admin)
check("keys, mouse keys and the theme save", s == 200, (s, b))
s, got = send("GET", "/me/settings", token=admin)
check("and come back the same", got["shortcuts"]["sp.select"] == ["X"] and got["mouse"] == {"mouse.dup": "Shift", "mouse.add": "Alt"} and got["theme"] == "dark", got)
for label, body in [
    ("an unknown function", {"shortcuts": {"sp.fly": ["F"]}, "mouse": {}, "theme": None}),
    ("three keys in a row", {"shortcuts": {"sp.select": ["A", "B", "C"]}, "mouse": {}, "theme": None}),
    ("a key that isn't a key", {"shortcuts": {"sp.select": ["Ctrl+<script>"]}, "mouse": {}, "theme": None}),
    ("a held key that isn't Shift, Ctrl or Alt", {"shortcuts": {}, "mouse": {"mouse.add": "Hyper"}, "theme": None}),
    ("two mouse rows holding one key", {"shortcuts": {}, "mouse": {"mouse.add": "Alt"}, "theme": None}),
    ("a named key no keyboard has", {"shortcuts": {"sp.pen": ["Ctrl+Shift+Alt+Cmd+ABCDEFGHIJKL"]}, "mouse": {}, "theme": None}),
    ("a held key twice", {"shortcuts": {"sp.pen": ["Ctrl+Ctrl+P"]}, "mouse": {}, "theme": None}),
    ("the same key twice for one function", {"shortcuts": {"sp.pen": ["P", "P"]}, "mouse": {}, "theme": None}),
    ("one key for two functions on one page", {"shortcuts": {"sp.pen": ["Q"], "sp.marker": ["Q"]}, "mouse": {}, "theme": None}),
    ("a key another function on the page has by default", {"shortcuts": {"sp.pen": ["M"]}, "mouse": {}, "theme": None}),
    ("a two key sequence that starts with a default key", {"shortcuts": {"sp.pen": ["G", "O"]}, "mouse": {}, "theme": None}),
    ("a key that starts another function's two key sequence", {"shortcuts": {"nav.next": ["Q"], "sp.pen": ["Q", "W"]}, "mouse": {}, "theme": None}),
    ("a theme that isn't light or dark", {"shortcuts": {}, "mouse": {}, "theme": "sepia"}),
]:
    s, b = send("PUT", "/me/settings", body, admin)
    check(f"{label} is refused", s == 400, (s, b))
send("PUT", "/me/settings", {"shortcuts": {}, "mouse": {}, "theme": None}, admin)

# The ids the API knows are the page's ids, read from both sources
here = os.path.dirname(os.path.abspath(__file__))
ts = open(os.path.join(here, "..", "angular", "src", "app", "services", "shortcuts.ts"), encoding="utf-8").read()
cs = open(os.path.join(here, "..", "api_v2", "Endpoints", "MeEndpoints.cs"), encoding="utf-8").read()
ts_fonts = open(os.path.join(here, "..", "angular", "src", "app", "Components", "scratchpad", "rich-text.ts"), encoding="utf-8").read()
rules = open(os.path.join(here, "..", "api_v2", "Scratchpad", "BoardRules.cs"), encoding="utf-8").read()
# Each command with its default keys: ('sp.pen', ('P',)), from the page's COMMANDS and the API's CommandDefaults
page_defaults = {i: tuple(re.findall(r"'([^']+)'", d)) for i, d in re.findall(r"\{ id: '([a-z]+\.[A-Za-z0-9]+)'[^\n]*?def: \[([^\]]*(?:\][^,\]]*)?)\]", ts)}
page_defaults.update({f"ov.slice{n}": (str(n),) for n in range(1, 6)})
page_defaults.pop("ov.slice", None)
api_block = cs[cs.index("CommandDefaults = new()"):cs.index("};", cs.index("CommandDefaults = new()"))]
api_defaults = {i: tuple(re.findall(r'"([^"]+)"', d)) for i, d in re.findall(r'\["([a-z]+\.[A-Za-z0-9]+)"\] = \[(.*?)\](?:,|\s*$)', api_block, re.M)}
check("the API knows exactly the page's shortcut ids and their default keys", page_defaults == api_defaults,
      sorted(set(page_defaults.items()) ^ set(api_defaults.items())))
page_fonts = set(re.findall(r"'([A-Za-z0-9 ]+)'", ts_fonts[ts_fonts.index("FONT_GROUPS"):ts_fonts.index("];", ts_fonts.index("FONT_GROUPS"))])) - {"Sans serif", "Serif", "Monospace", "Display", "Handwriting"}
api_fonts = set(re.findall(r'"([A-Za-z0-9 ]+)"', rules[rules.index("Fonts ="):rules.index("];", rules.index("Fonts ="))]))
check("the API knows exactly the page's 28 fonts", page_fonts == api_fonts and len(api_fonts) == 28, (sorted(page_fonts ^ api_fonts), len(api_fonts)))
mouse_ts = set(i for i in re.findall(r"\{ id: '(mouse\.[a-z]+)'.*?def: '", ts))
mouse_cs = set(re.findall(r'"(mouse\.[a-z]+)"', cs))
check("and the mouse rows that can change", mouse_ts == mouse_cs, (mouse_ts, mouse_cs))

print("\n5b. The profile card: a name and a picture")
def raw(method, path, data, content_type, token):
    # The picture goes up as the body itself, not JSON
    req = urllib.request.Request(t.BASE + path, data=data, method=method)
    req.add_header("Content-Type", content_type)
    req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
import zlib, struct
def png():
    # A real 1 by 1 PNG, so the bytes are a picture and not only its first eight
    chunk = lambda kind, body: struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(b"\x00\xff\x00\x00")) + chunk(b"IEND", b"")
s, b = send("PUT", "/me/profile", {"displayName": "  Ada   Lovelace  "}, admin)
check("a name is saved tidied, and the username stays", s == 200 and b["displayName"] == "Ada Lovelace" and b["username"] == "admin", (s, b))
s, b = send("GET", "/auth/me", token=admin)
check("and /auth/me says it", b.get("displayName") == "Ada Lovelace", b)
s, b = send("PUT", "/me/profile", {"displayName": "x" * 61}, admin)
check("a name over 60 characters is refused", s == 400, (s, b))
s, b = send("PUT", "/me/profile", {"displayName": "   "}, admin)
check("an empty name puts the username back", s == 200 and b["displayName"] is None, (s, b))
picture = png()
s, body = raw("PUT", "/me/avatar", picture, "image/png", admin)
check("a PNG picture is kept", s == 200 and json.loads(body)["avatarAt"], (s, body[:200]))
s, body = raw("GET", "/me/avatar", None, "image/png", admin)
check("and comes back byte for byte", s == 200 and body == picture, (s, len(body)))
s, body = raw("PUT", "/me/avatar", b"GIF89a not really", "image/png", admin)
check("bytes that aren't the picture type they claim are refused", s == 400, (s, body[:200]))
s, body = raw("PUT", "/me/avatar", picture, "image/jpeg", admin)
check("a PNG sent as JPEG is refused", s == 400, (s, body[:200]))
s, body = raw("PUT", "/me/avatar", b"\x89PNG\r\n\x1a\n" + b"0" * (301 * 1024), "image/png", admin)
check("a picture over 300 KB is refused", s == 400, (s, body[:200]))
s, b = send("DELETE", "/me/avatar", token=admin)
check("removing the picture clears it", s == 200 and b["avatarAt"] is None, (s, b))
s, body = raw("GET", "/me/avatar", None, "image/png", admin)
check("and there is nothing to fetch after", s == 404, s)
s, body = raw("GET", "/me/avatar", None, "image/png", "not-a-token")
check("nobody signed out can fetch a picture", s == 401, s)

print("\n6. The file sweep")
def upload(name, body=b"x" * 64):
    boundary = uuid.uuid4().hex
    data = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{name}\"\r\nContent-Type: image/png\r\n\r\n").encode() + body + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(t.BASE + "/scratchpad/files", data=data, method="POST")
    req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    req.add_header("Authorization", "Bearer " + admin)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())
used, spare, old = upload("used.png"), upload("spare.png"), upload("old.png")
# The used file sits on a different board from the one saved below, so the sweep has to look at all of them
s, keep = send("POST", "/scratchpad/boards", {"name": "Keeps a file", "document": {**EMPTY, "items": [
    {"id": "f", "type": "file", "x": 0, "y": 0, "w": 240, "h": 212, "fileId": used["id"], "name": "used.png", "contentType": "image/png", "sizeBytes": 64}]}}, admin)
# old.png: uploaded and unused for over 7 days, as far as the sweep can tell
psql(t.MAIN_DB, f"""UPDATE "ScratchFiles" SET "CreatedAt" = now() - interval '9 days', "OrphanedAt" = now() - interval '8 days' WHERE "Id" = {old['id']}""")
psql(t.MAIN_DB, f"""UPDATE "ScratchFiles" SET "CreatedAt" = now() - interval '9 days', "OrphanedAt" = now() - interval '8 days' WHERE "Id" = {used['id']}""")
print("  waiting for the sweep (up to 75 seconds)...")
deadline = time.time() + 75
while time.time() < deadline:
    if psql(t.MAIN_DB, f"""SELECT count(*) FROM "ScratchFiles" WHERE "Id" = {old['id']}""") == "0": break
    time.sleep(3)
time.sleep(2)
gone = lambda f: psql(t.MAIN_DB, f"""SELECT count(*) FROM "ScratchFiles" WHERE "Id" = {f['id']}""") == "0"
check("a file unused for 7 days is deleted, row and file", gone(old) and send("GET", f"/scratchpad/files/{old['id']}", token=admin)[0] == 404)
check("a file a board uses is never deleted, however old, and its unused mark is cleared",
      not gone(used) and psql(t.MAIN_DB, f"""SELECT "OrphanedAt" IS NULL FROM "ScratchFiles" WHERE "Id" = {used['id']}""") == "t")
check("a file unused for less than 7 days stays, marked from when it was first found unused",
      not gone(spare) and psql(t.MAIN_DB, f"""SELECT "OrphanedAt" IS NOT NULL FROM "ScratchFiles" WHERE "Id" = {spare['id']}""") == "t")

print("\n7. Tidying up")
for b in (board, copy["id"], keep["id"]):
    send("PATCH", f"/scratchpad/boards/{b}", {"pinned": False}, admin)
    send("DELETE", f"/scratchpad/boards/{b}", token=admin)
check("the check's boards are gone", all(send("GET", f"/scratchpad/boards/{b}", token=admin)[0] == 404 for b in (board, copy["id"], keep["id"])))

print("\n" + (f"{len(fails)} failed" if fails else "SCRATCHPAD OK"))
sys.exit(1 if fails else 0)
