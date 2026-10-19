# The start-up hand-over between the two migration chains (backend/Infrastructure/Startup/MigrationService.cs, HandOverAsync).
# A database from before the chains were split has state steps (here NamedBoardsSettingsTray) recorded in the data
# chain's history. Starting the API must move them to the state chain's history and never run them twice, run the
# state steps that are left, keep every row, and leave no one-board-per-person index behind (ManyBoardsPerPerson).
#   python3 -I check_handover.py    stop the throwaway API first; this starts its own copy on port 5106 and stops it
# Both throwaway databases are dumped first and loaded back at the end.
import os, subprocess, sys, time, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pg, t

check = pg.Checks()
PORT = 5106
named = "20261010073223_NamedBoardsSettingsTray"

pg.nobody_connected(t.MAIN_DB, t.COLLECTOR_DB)
if pg.applied() != pg.migrations() or pg.applied(chain="state") != pg.migrations("state"):
    sys.exit("Bring both chains up first: start the throwaway API once, stop it, run this again")
print("building the API (Release)")
pg.build()
safe = os.path.join(t.BACKUPS, "dumps", "handover-" + time.strftime("%Y-%m-%d_%H%M%S"))
os.makedirs(safe, exist_ok=True)
pg.dump(t.MAIN_DB, os.path.join(safe, "main.dump"))
pg.dump(t.COLLECTOR_DB, os.path.join(safe, "collector.dump"))
start = pg.snapshot()

# The state chain back to just after NamedBoardsSettingsTray, then its record moved where a database from before the
# split keeps it: in the data chain's history, with the state chain's history holding nothing at all
pg.update(named, chain="state")
pg.sql(t.MAIN_DB, f"""INSERT INTO "__EFMigrationsHistory" SELECT * FROM "__StateMigrationsHistory" WHERE "MigrationId" = '{named}';
                      DROP TABLE "__StateMigrationsHistory";""")
before = pg.snapshot()
print(f"  made it look like before the split: data history ends {pg.short(before['applied'][-1])}, no state history")

print("\nstarting the API on", PORT)
env = dict(os.environ, ASPNETCORE_ENVIRONMENT="Throwaway")
api = subprocess.Popen(["dotnet", "run", "-c", "Release", "--no-launch-profile", "--no-build", "--urls", f"http://localhost:{PORT}"],
                       cwd=pg.API, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
try:
    ready = None
    for _ in range(90):
        try:
            with urllib.request.urlopen(f"http://localhost:{PORT}/health", timeout=5) as r:
                body = r.read().decode()
                if '"state":"ready"' in body or '"state":"failed"' in body:
                    ready = body
                    break
        except Exception:
            pass
        time.sleep(2)
    check("the API comes up ready", ready is not None and '"state":"ready"' in ready, ready)
finally:
    api.terminate()
    try:
        out, _ = api.communicate(timeout=30)
    except subprocess.TimeoutExpired:
        api.kill()
        out, _ = api.communicate()
    time.sleep(2)

after = pg.snapshot()
check("the step was moved out of the data chain's history", named not in after["applied"], after["applied"][-2:])
check("and is in the state chain's history, with every state step", after["state"] == pg.migrations("state"), after["state"])
check("it ran once only: the API window shows no failed command", "Failed executing" not in out and "Migration failed" not in out,
      [line for line in out.splitlines() if "fail" in line.lower()][:5])
check("the API window says it moved one step", "Moved 1 step(s)" in out, out[-600:])
index = pg.sql(t.MAIN_DB, """SELECT count(*) FROM pg_indexes WHERE indexname = 'IX_ScratchBoards_UserId'""")
check("no one-board-per-person index is left", index == "0", index)
check("every account, board and company is as it was (only the steps after it changed their own columns)",
      pg.counts(before["rows"]).get('main.public."ScratchBoards"') == pg.counts(after["rows"]).get('main.public."ScratchBoards"')
      and pg.counts(before["rows"]).get('main.public."Users"') == pg.counts(after["rows"]).get('main.public."Users"'),
      {k: (pg.counts(before["rows"]).get(k), pg.counts(after["rows"]).get(k)) for k in ('main.public."ScratchBoards"', 'main.public."Users"')})
check("the layout ends exactly as the database it started from", after["layout"] == start["layout"], pg.layout_diff(start["layout"], after["layout"]))

pg.restore(os.path.join(safe, "main.dump"), t.MAIN_DB)
pg.restore(os.path.join(safe, "collector.dump"), t.COLLECTOR_DB)
ended = pg.snapshot()
check("the throwaway databases are loaded back from the dump", ended["rows"] == start["rows"], pg.changed(start["rows"], ended["rows"]))
print("\n" + (f"{len(check.fails)} failed" if check.fails else "HANDOVER OK"))
sys.exit(1 if check.fails else 0)
