# Checks

The scripts that checked batch 8, kept so the next round doesn't start from nothing. They only ever talk to a throwaway API on its own port, pointed at throwaway databases. Never point them at the real one, `check_big.py` and `stress.py` delete rows.

## Setup

1. A throwaway Postgres. Docker: `docker compose up -d` gives one on 5433. Without Docker, start one by hand on 5433 with the user and password from `docker-compose.yml`.
2. A throwaway API. Build `api_v2`, copy `appsettings.Throwaway.example.json` next to the built `api_v2.exe` as `appsettings.Production.json` (fix the paths in it), then run it with `ASPNETCORE_ENVIRONMENT=Production` and `ASPNETCORE_URLS=http://localhost:5104`. The first start prints the admin password in that window.
3. Python 3.13 or newer, nothing to install. The page check needs Node 22.23.3 or newer and the `playwright` package with Chromium.

Every script reads `API` (default `http://localhost:5104`) and `ADMIN_PASSWORD` (default `Admin-pass-2026!`) from the environment.

## The scripts

| Script | What it checks | How to run |
|---|---|---|
| `check_restore.py` | The whole restore from a backup round trip: rows, rules, requests and retention back, accounts and the token kept, the copy at the top of History, then a backup from another layout refused and a damaged dump refused with no copy left behind | first time `python3 -I check_restore.py <password from the API window>`, it sets the admin password. After that `python3 -I check_restore.py x again` |
| `check_big.py` | Timings on a big table: copy to History, restore from History, bring back, restore from a backup | `python3 -I check_big.py 100000` (rows to insert) |
| `check_monitor.py` | History taken away under the running API: adds answer 503, `/health` says offline at once, back within 30 seconds | `python3 -I check_monitor.py` (renames the collector database and back, needs psql on 5433) |
| `stress.py` | The race test: three restores at once each round under 8 threads of adds, edits, deletes, bring backs, rules saves, retention saves and backups. Fails on any 500, a lock wait that ran out, a pending change log entry, a scratch database left behind or two originals with one name | `python3 -I stress.py 30` for 30 rounds on 300 rows, `python3 -I stress.py 10 20000` for 10 rounds on 20,000 rows |
| `check_page.mjs` | The Restore panel in a headless browser at 1280 and 390 wide and in dark mode, runs a restore, saves screenshots, reports console errors and sideways scroll | with the page on 4200 and the API on the address in `environment.ts`: `node check_page.mjs <folder for screenshots>` from a folder that has `playwright` in `node_modules` |
| `check_design.mjs` | The batch 9 design checks: the nav at 390, errors under their field, the delete question, the History card on a phone, the sign in page, a disabled button in dark mode, screenshots of each | same setup as `check_page.mjs`: `node check_design.mjs <folder for screenshots>` |
| `contrast.py` | WCAG contrast of the colour pairs the UI judge pointed at, read from `styles.css`, light and dark | `python3 -I contrast.py ../angular/src/styles.css`, every line should say ok |
| `grade_setup.py` | Builds the state `rubric_batches_8_9.md` asks for on a throwaway API: 300 rows with a long name, a custom field with a value in 12 rows, two amber rows, a backup, 20 rows deleted after it, and a copy of the backup marked as another layout | `python3 -I grade_setup.py <password from the API window>` on a fresh database, with `BACKUPS` pointing at the backup folder if it isn't the default |
| `grade_capture.mjs` | Takes captures 1 to 7 of the rubric (screenshots and `facts.json` with the console readings) for a critic to grade. `START=4` resumes from capture 4 | `node grade_capture.mjs <folder>` after `grade_setup.py`, with the page on 4200. Raise `Auth:LoginTriesPerMinute` in the throwaway settings first, capture 7 signs in six times in a row |
| `t.py` | The API client the others share | not run on its own |

`check_restore.py` and `check_big.py` can run one after the other on the same database. `stress.py` empties the table first and leaves it with whatever the rounds made, run it last or on its own copy.

## What a pass looks like

- `check_restore.py` ends with `RESTORE OK` and `REFUSALS OK`
- `check_big.py` ends with `BIG OK` and prints each timing
- `check_monitor.py` ends with `MONITOR OK`
- `stress.py` ends with `STRESS OK` and `errors: 0`
- `check_design.mjs` prints `no sideways scroll: true` twice, a focus ring of `solid 2px`, two field problems with matching `describedBy`, and `page errors: none`
- `check_page.mjs` prints `no sideways scroll: true` three times and `console errors: none` (blocked font and icon downloads show up as errors on a box without internet, those don't count)
