# Backups carry the Tables page, a restore can be undone, and a backup can leave as a zip and come back in.
# Only a zip this app signed is ever loaded. Throwaway API only, like the other checks.
#   python3 -I check_backup_tables.py
# Start the throwaway API with Backup__MaxUploadMb=5 and its own Backup__SigningKeyFile (see testing/README.md).
import io, json, os, secrets, shutil, sys, time, urllib.request, uuid, zipfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import t
from t import call, login

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
    assert call("POST", "/auth/password", {"current": temp, "new": new}, token)[0] < 300
    return login(name, new)[0]

def raw(method, path, token, data=None, ctype=None):
    req = urllib.request.Request(t.BASE + path, data=data, method=method)
    req.add_header("Authorization", "Bearer " + token)
    if ctype: req.add_header("Content-Type", ctype)
    try:
        with urllib.request.urlopen(req, timeout=600) as r: return r.status, r.read()
    except urllib.error.HTTPError as e: return e.code, e.read()

def upload(token, name, content):
    b = "----b" + uuid.uuid4().hex
    body = (f"--{b}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{name}\"\r\n"
            "Content-Type: application/zip\r\n\r\n").encode() + content + f"\r\n--{b}--\r\n".encode()
    s, out = raw("POST", "/backups/upload", token, body, f"multipart/form-data; boundary={b}")
    try: return s, json.loads(out)
    except ValueError: return s, out.decode(errors="replace")

def zip_with(files):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, data in files.items(): z.writestr(name, data)
    return buf.getvalue()

def names(token):
    return sorted(x["name"] for x in call("GET", "/tables", token=token)[1])

def restore(token, backup_id):
    return call("POST", f"/backups/{backup_id}/restore", {"confirm": "RESTORE"}, token)

admin, _ = login("admin", t.ADMIN_PASSWORD)
manager = account(admin, "manager")
normal = account(admin, "normal")

for tb in call("GET", "/tables", token=admin)[1]: call("DELETE", f"/tables/{tb['id']}", token=admin)

print("who may touch backups")
check("a normal account can't list backups", call("GET", "/backups", token=normal)[0] == 403)
check("a manager can list backups", call("GET", "/backups", token=manager)[0] == 200)

print("a backup carries the tables")
s, keep = call("POST", "/tables", {"name": "Keep me", "columns": [{"label": "Note", "type": "text"}]}, manager)
for i in range(3): call("POST", f"/tables/{keep['id']}/rows", {"values": {"note": f"row {i}"}}, manager)
s, b1 = call("POST", "/backups", token=manager)
check("a manager takes a backup", s == 200, (s, b1))
folder = os.path.join(t.BACKUPS, b1["id"])
check("the backup is signed", os.path.exists(os.path.join(folder, "signature.json")))

call("DELETE", f"/tables/{keep['id']}", token=manager)
call("POST", "/tables", {"name": "Made after", "columns": [{"label": "X", "type": "number"}]}, manager)
check("before the restore: only the later table", names(manager) == ["Made after"], names(manager))

s, result = restore(manager, b1["id"])
check("a manager restores it", s == 200, (s, result))
check("everything is as it was in the backup", names(manager) == ["Keep me"], names(manager))
rows = call("GET", f"/tables/{keep['id']}/rows", token=manager)[1]
check("with its rows", rows.get("total") == 3, rows)
time.sleep(1)
files = os.listdir(MIRROR)
check("the copies folder was rewritten to match", any(f.endswith("-keep-me.json") for f in files) and not any(f.endswith("-made-after.json") for f in files), files)
undo = result.get("undoBackup") if isinstance(result, dict) else None
check("a full backup of before the restore was taken", bool(undo) and "before-restore" in undo, result)

s, again = restore(manager, undo)
check("restoring that undoes the restore", s == 200 and names(manager) == ["Made after"], (s, names(manager)))
restore(manager, b1["id"])

print("download and drop back in")
s, data = raw("GET", f"/backups/{b1['id']}/download", manager)
check("the backup downloads as one zip", s == 200 and zipfile.is_zipfile(io.BytesIO(data)), s)
inside = sorted(zipfile.ZipFile(io.BytesIO(data)).namelist())
check("the zip holds exactly the signed files", inside == sorted(["backup.json", "collector.dump", "main.csv", "main.dump", "signature.json"]), inside)

s, b = upload(manager, "same.zip", data)
check("the same backup again is reported as already there", s == 409 and b1["id"] in json.dumps(b), (s, b))

files_in = {n: zipfile.ZipFile(io.BytesIO(data)).read(n) for n in inside}
tampered = dict(files_in); dump = bytearray(tampered["main.dump"]); dump[len(dump) // 2] ^= 0xFF; tampered["main.dump"] = bytes(dump)
s, b = upload(manager, "tampered.zip", zip_with(tampered))
check("one changed byte: refused as not ours", s == 400 and "made by this app" in json.dumps(b), (s, b))
s, b = upload(manager, "extra.zip", zip_with({**files_in, "notes.txt": b"hi"}))
check("an extra file: refused", s == 400, (s, b))
s, b = upload(manager, "path.zip", zip_with({**{k: v for k, v in files_in.items() if k != "main.dump"}, "../main.dump": files_in["main.dump"]}))
check("a path in a name: refused", s == 400, (s, b))
unsigned = {k: v for k, v in files_in.items() if k != "signature.json"}
s, b = upload(manager, "unsigned.zip", zip_with(unsigned))
check("an unsigned backup: refused for upload", s == 400, (s, b))
s, b = upload(manager, "junk.zip", b"not a zip at all")
check("not a zip: refused", s == 400, (s, b))
s, b = upload(manager, "big.zip", os.urandom(6 * 1024 * 1024))
check("over the size cap: refused and says the cap", s == 413 and "5 MB" in json.dumps(b), (s, b))
s, b = upload(normal, "same.zip", data)
check("a normal account can't upload", s == 403, s)
leftovers = [n for n in os.listdir(t.BACKUPS) if n.startswith(".")]
check("refused uploads leave nothing behind", leftovers == [], leftovers)

# The same zip on a setup that no longer has the folder: it comes back as an uploaded backup and restores
shutil.rmtree(folder)
s, up = upload(manager, f"backup-{b1['id']}.zip", data)
check("dropped in where it isn't listed: added as uploaded", s == 200 and up.get("kind") == "uploaded", (s, up))
call("DELETE", f"/tables/{keep['id']}", token=manager)
s, r = restore(manager, up["id"]) if s == 200 else (0, None)
check("the uploaded backup restores", s == 200 and names(manager) == ["Keep me"], (s, r, names(manager)))

# An older backup without a signature still restores from the list, only uploading needs one
s, b2 = call("POST", "/backups", token=manager)
os.remove(os.path.join(t.BACKUPS, b2["id"], "signature.json"))
s, r = restore(manager, b2["id"])
check("an unsigned backup on the list still restores", s == 200, (s, r))

print("\n" + (f"{len(fails)} failed" if fails else "BACKUP TABLES OK"))
sys.exit(1 if fails else 0)
