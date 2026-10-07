# The API client the checks share. API is the throwaway API's address, ADMIN_PASSWORD the admin password it uses.
import json, sys, os, urllib.request, urllib.error, time, random
BASE = os.environ.get("API", "http://localhost:5104")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "Admin-pass-2026!")
TOK = None
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
