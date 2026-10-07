# Checks

The scripts that checked batch 8, kept so the next round doesn't start from nothing. They only ever talk to a throwaway API on its own port, pointed at throwaway databases. Never point them at the real one, `check_big.py` and `stress.py` delete rows.

## Setup

1. A Postgres on 5433. `docker compose up -d` gives one. The checks use their own databases on it, `throwaway_main` and `throwaway_collector`, so the `main` and `collector` that `start.bat` uses are never touched. `t.py` refuses to run against `main`, `collector` or `api_v2`, and refuses the API on 5005 or 7165.
2. A throwaway API. In `api_v2`, copy `..\testing\appsettings.Throwaway.example.json` to `appsettings.Throwaway.json` (git ignores it), then from the `api_v2` folder:

   ```
   set ASPNETCORE_ENVIRONMENT=Throwaway
   dotnet run -c Release --no-launch-profile --urls http://localhost:5104
   ```

   `-c Release` builds into its own folder, so it runs next to `start.bat`'s API without fighting over the files. The first start makes both throwaway databases and prints the admin password in that window. Backups go to `testing/throwaway-backups` (git ignores it).
3. Set `ADMIN_PASSWORD` to the password the checks should use, for example `set ADMIN_PASSWORD=Pick-one-2026!`. There's no default on purpose. `check_restore.py` and `grade_setup.py` set it as the admin password on a first run.
4. Python 3.13 or newer, nothing to install. The page checks need Node 22.23.3 or newer and the `playwright` package with Chromium.

   **Two playwrights share one browser cache, and they want different Chromium builds.** The `playwright` in `testing/node_modules` is 1.64 and asks for one Chromium revision; the Python `playwright` wheel asks for another. Installing only the Python one, or only `npm install` in `testing/`, leaves the other's browser missing and the check stops before printing anything with `Executable doesn't exist at ...\ms-playwright\chromium_headless_shell-<revision>\...`. Install the Node side's browser once, from `testing/`:

   ```
   node node_modules\playwright\cli.js install chromium-headless-shell
   ```

   That only adds the revision it needs, so the Python checks keep working. A first run here needed 1248 while the cache held 1228 and took about 120 MB.

The Python scripts read `API` (default `http://localhost:5104`), `ADMIN_PASSWORD`, `MAIN_DB`, `COLLECTOR_DB` and `BACKUPS` from the environment.

The page checks (`check_page.mjs`, `check_design.mjs`, `grade_capture.mjs`, `grade_recapture.mjs`) drive the page, and the page calls the API on 5005. For those, close `start.bat`'s API window and run the throwaway API with `--urls http://localhost:5005` instead.

## The scripts

| Script | What it checks | How to run |
|---|---|---|
| `check_restore.py` | The whole restore from a backup round trip: rows, rules, requests and retention back, accounts and the token kept, the copy at the top of History, then a backup from another layout refused and a damaged dump refused with no copy left behind | first time `python3 -I check_restore.py <password from the API window>`, it sets the admin password. After that `python3 -I check_restore.py x again` |
| `check_big.py` | Timings on a big table: copy to History, restore from History, bring back, restore from a backup | `python3 -I check_big.py 100000` (rows to insert) |
| `check_monitor.py` | History taken away under the running API: adds answer 503, `/health` says offline at once, back within 30 seconds | `python3 -I check_monitor.py` (renames the collector database and back, needs psql on 5433) |
| `stress.py` | The race test: three restores at once each round under 8 threads of adds, edits, deletes, bring backs, rules saves, retention saves and backups. Fails on any 500, a lock wait that ran out, a pending change log entry, a scratch database left behind or two originals with one name | `python3 -I stress.py 30` for 30 rounds on 300 rows, `python3 -I stress.py 10 20000` for 10 rounds on 20,000 rows |
| `check_page.mjs` | The Restore panel in a headless browser at 1280 and 390 wide and in dark mode, runs a restore, saves screenshots, reports console errors and sideways scroll | with the page on 4200 and the API on the address in `environment.ts`: `node check_page.mjs <folder for screenshots>` from a folder that has `playwright` in `node_modules` |
| `check_ui.mjs` | The five changes a jsdom test cannot see: Fields and History on the normal nav, the restore question asking for a note and flashing the signal colour, the age line on each saved copy, and the shortcuts panel blurring the page behind it and dimming it only a little, light and dark. It **never confirms a restore**: it opens the question, types into the note box to prove the button turns on at ten characters, and leaves with Escape | with the page on 4200 and the API on 5005: `node check_ui.mjs <folder for screenshots>` from `testing/`. Reads the sign in from `../scripts/seeding.control.toml` and refuses any host that is not localhost. With no folder it writes beside the repo, at `../dsh-shots/after`, never inside it |
| `check_design.mjs` | The batch 9 design checks: the nav at 390, errors under their field, the delete question, the History card on a phone, the sign in page, a disabled button in dark mode, screenshots of each | same setup as `check_page.mjs`: `node check_design.mjs <folder for screenshots>` |
| `contrast.py` | WCAG contrast of the colour pairs the UI judge pointed at, read from `styles.css`, light and dark | `python3 -I contrast.py ../angular/src/styles.css`, every line should say ok |
| `grade_setup.py` | Builds the state `rubric_batches_8_9.md` asks for on a throwaway API: 300 rows with a long name, a custom field with a value in 12 rows, two amber rows, a backup, 20 rows deleted after it, and a copy of the backup marked as another layout | `python3 -I grade_setup.py <password from the API window>` on a fresh database, with `BACKUPS` pointing at the backup folder if it isn't the default |
| `grade_capture.mjs` | Takes captures 1 to 7 of the rubric (screenshots and `facts.json` with the console readings) for a critic to grade. `START=4` resumes from capture 4 | `node grade_capture.mjs <folder>` after `grade_setup.py`, with the page on 4200. Capture 7 signs in six times in a row, the example settings already allow 100 tries a minute |
| `grade_recapture.mjs` | The captures the first grading round found missing: a real amber row with its red Delete text and its flag, the flag focused by Tab, the spinner read from the DOM, the account page problems under their boxes, the phone cells | `node grade_recapture.mjs <folder>` after `grade_capture.mjs`, adds to its `facts.json` |
| `t.py` | What the others share: the API client, the throwaway database names, psql and the safety checks | not run on its own |

`check_restore.py` and `check_big.py` can run one after the other on the same database. `stress.py` empties the table first and leaves it with whatever the rounds made, run it last or on its own copy.

## What a pass looks like

- `check_restore.py` ends with `RESTORE OK` and `REFUSALS OK`
- `check_big.py` ends with `BIG OK` and prints each timing
- `check_monitor.py` ends with `MONITOR OK`
- `stress.py` ends with `STRESS OK` and `errors: 0`
- `check_design.mjs` prints `no sideways scroll: true` twice, a focus ring of `solid 2px`, two field problems with matching `describedBy`, and `page errors: none`
- `check_page.mjs` prints `no sideways scroll: true` three times and `console errors: none` (blocked font and icon downloads show up as errors on a box without internet, those don't count)
- `check_ui.mjs` prints fifteen `ok` lines and ends with `all checks passed`, exit 0. The dim line prints the real opacity it read, `0.85`, so a pass shows the number rather than just a tick
