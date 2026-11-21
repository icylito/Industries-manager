# Testing

These are the scripts we run against the whole app before calling a change done: restores, backups, migrations, the name rule, the Scratchpad, and a stress test that throws restores and edits at the API at the same time.

Most of them delete rows on purpose, so they never touch your real data. They run against a throwaway API on port 5104 with its own databases, `throwaway_main` and `throwaway_collector`. `t.py` refuses to start if it's pointed at the API on 5005 or 7165, or at a database called `main`, `collector` or `api_v2`.

## Getting set up

You'll need the Docker database from the main README running on port 5433, and Python 3.13 or newer. The Python scripts have nothing to install.

**1. Give the throwaway API its settings.** From the project folder:

```bat
copy testing\appsettings.Throwaway.example.json api_v2\appsettings.Throwaway.json
```

Git ignores the copy, so you can change it freely.

**2. Start the throwaway API** in its own window, from `api_v2`:

```bat
set ASPNETCORE_ENVIRONMENT=Throwaway
set Backup__SigningKeyFile=..\testing\throwaway-backups\backup-signing.key
set Scratchpad__Files=..\testing\throwaway-backups\scratchpad-files
set UserTables__Mirror=..\testing\throwaway-backups\user-tables
dotnet run -c Release --no-launch-profile --urls http://localhost:5104
```

Don't skip the three `set` lines in the middle. The example settings only move the backups folder, so without them the first start writes a backup key and two folders at the project root, right where the real ones go. `-c Release` builds into its own folder, so this API runs next to `start.bat`'s without the two fighting over files.

The first start makes both throwaway databases and prints an admin password in that window, the same as the real app.

**3. Tell the scripts which password to use.** There's no default on purpose:

```bat
set ADMIN_PASSWORD=Pick-one-2026!
```

On a first run, `check_restore.py` and `grade_setup.py` take the password from the API window and change it to this one.

That's all the Python scripts need. They also read `API` (default `http://localhost:5104`), `MAIN_DB`, `COLLECTOR_DB` and `BACKUPS` if you want to point them somewhere else.

## Running a check

From `testing`:

```bat
python -I check_names.py
```

Each script prints an `ok` line per thing it checked and ends with one line in capitals, like `NAMES OK`. Anything else is a failure, and the line above it says what went wrong.

Some scripts need the API started with an extra setting, or need it stopped. That's in the last column below.

### Restores and backups

| Script | What it checks | A pass ends with | Before you run it |
|---|---|---|---|
| `check_restore.py` | A full backup restore: rows, rules and requests come back, accounts stay, a backup from another layout and a damaged dump are both refused | `RESTORE OK`, `REFUSALS OK` | First time: `python -I check_restore.py <password from the API window>`. After that: `python -I check_restore.py x again` |
| `check_backup_tables.py` | Backups carry the Tables page, a backup downloads as one signed zip and goes back in, and a changed byte, extra file, unsigned zip or oversized file is refused | `BACKUP TABLES OK` | Start the API with `set Backup__MaxUploadMb=5` |
| `check_versions.py` | Deleting a saved History version: admins can, managers can't, a pinned one can't go, and a delete waits for a restore of the same version | `VERSIONS OK` | Nothing extra |
| `check_history_limits.py` | A restore note over 300 characters is refused, a JSON body over 2 MB is refused, and an import has to say skip or keep on duplicates | 21 `ok` lines | Nothing extra |
| `check_dump.py` | A database dump loads back whole: every table, row and id counter, plus every Scratchpad file still on disk | `DUMP OK` | Stop the API. Add a backup folder to check an app backup, though it can't read the encrypted ones yet |
| `check_monitor.py` | History going offline under the running API: adds answer 503, `/health` says so at once, and it's back within 30 seconds | `MONITOR OK` | Needs `psql` on 5433 |

### Migrations

All four need the throwaway API **stopped**. They dump both throwaway databases first and load them back at the end, so they leave nothing behind unless you set `KEEP=1`.

| Script | What it checks | A pass ends with |
|---|---|---|
| `check_migration.py` | The newest migration forward, back and forward again: the layout and every row come back exactly. `set MIGRATION=Name` to check another one, `CHAIN=state` for the state chain | `MIGRATION OK` |
| `check_migration_walk.py` | Every data migration down to the oldest layout and back up, one step at a time, with rows checked at each step | `WALK OK` (93 `ok` lines) |
| `check_handover.py` | The startup step that moves old migrations from the data chain to the state chain | `HANDOVER OK` |

`check_migration.py` on `OneNameRule` needs `set EXPECT_CHANGED=Industries,UserTables` and `set KEPT=Industries,UserTables`, because that migration renames clashing names on purpose. On `NamedBoardsSettingsTray` it needs `CHAIN=state` and `EXPECT_CHANGED=ScratchBoards,ScratchFiles`.

### Rules and features

| Script | What it checks | A pass ends with | Before you run it |
|---|---|---|---|
| `check_names.py` | The one name rule, held to the same 16 example pairs in Postgres, the API and the page | `NAMES OK` | Nothing extra |
| `check_tables.py` | The Tables page: every column rule, the limits, who may do what, and the JSON copies on disk | `TABLES OK` (46 `ok` lines) | Nothing extra |
| `check_scratchpad.py` | Boards, the board rules, the carry tray, personal shortcuts, and the sweep that removes unused files | `SCRATCHPAD OK` | Start the API with `set Scratchpad__SweepMinutes=1` |
| `check_fixes.py` | Stale edits refused, sign in limits answering 429, and `/health` saying only the state to someone signed out | `FIXES OK` (21 `ok` lines) | Start the API with `set Auth__LoginTriesPerMinute=5` |

### Load and timing

| Script | What it checks | Run it with |
|---|---|---|
| `check_big.py` | How long copies and restores take on a big table | `python -I check_big.py 100000`, ends with `BIG OK` and the timings |
| `stress.py` | Three restores at once under 8 threads of edits, deletes, rules saves and backups. Fails on any 500, a stuck lock or a duplicate name | `python -I stress.py 30` for 30 rounds on 300 rows, ends with `STRESS OK` and `errors: 0` |

Run `stress.py` last or on its own. It empties the table first and leaves whatever the rounds made.

### In the browser

`check_page.mjs`, `check_design.mjs`, `check_ui.mjs`, `grade_capture.mjs` and `grade_recapture.mjs` open the page in a headless Chromium and save screenshots to the folder you give them. They need Node 22 and Playwright, and the page on 4200 calling an API on 5005, so close `start.bat`'s API and run the throwaway one with `--urls http://localhost:5005` instead. `check_ui.mjs` reads the sign in from `scripts/seeding.control.toml` and never confirms a restore.

`contrast.py` checks the colour pairs in `styles.css` against WCAG, light and dark: `python -I contrast.py ..\angular\src\styles.css`, and every line should say ok.

`t.py` and `pg.py` aren't checks. They hold what the others share: the API client, the safety checks, and psql, `pg_dump` and `pg_restore`.

## When a check won't run

| What you see | What to do |
|---|---|
| The script refuses the API or the database | It's pointed at your real app. Check `API`, `MAIN_DB` and `COLLECTOR_DB`, and start the throwaway API on 5104. |
| `backup-key/` or `scratchpad-files/` appeared at the project root | The throwaway API started without the three `set` lines. Stop it, delete the new folders, and start it again with them. |
| A migration check says something is connected | The throwaway API is still running, or pgAdmin has the database open. Close both. |
| `Executable doesn't exist at ...\ms-playwright\chromium_headless_shell-...` | The Node and Python Playwrights want different Chromium builds. From `testing`, run `node node_modules\playwright\cli.js install chromium-headless-shell`. It only adds the missing one, about 120 MB. |
| `check_fixes.py` fails on sign in | The throwaway settings allow 100 tries a minute so the other checks don't get locked out. Restart the API with `set Auth__LoginTriesPerMinute=5` for this one. |

Three checks are known to fail right now. `stress.py` expects a backup restore to wait for a running backup, and the app refuses it instead. `check_dump.py` can't read the encrypted dumps in an app backup. The browser scripts still look for the History page from before its redesign.

## Backups stay on the PC that made them

This one is done by hand, and it needs this PC and a second device.

1. Make a copy with this PC's data, from the project folder:
   `powershell -ExecutionPolicy Bypass -File testing\make-copy.ps1 -WithData`
   It writes `Desktop\stock-listing-copy` with the backups, the backup key and the database login.
2. Stop the original API (both use port 5005), run `start.bat` inside the copy, and open History. Every backup should be listed and download fine.
3. From the copy's folder, check the backups:
   `dotnet run --project testing\transfer-check -- --folder "$PWD\backups" --key "$PWD\backup-key\backup-signing.key"`
   Give full paths like that, because `dotnet run --project` changes the folder it runs in. Every line should say `OK`, with `Computer:` showing this PC's name.
4. Move the copy to the other device and run step 3 there. It should print `KEY LOCKED HERE` and exit with code 1, because nothing in that folder opens on another device.
5. On any device that should run the app on its own, make a clean copy with `make-copy.ps1` and no `-WithData`. It has no data and no key, so the app makes its own and starts empty.

The check only reads. It never makes or changes a key, so it's safe to run on a copy.
