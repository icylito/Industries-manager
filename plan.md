# Stock Listing plan and handoff

Project is in `Desktop/testing`. Last updated 2026-10-07 (batches 8 and 9 merged into main).

The app lists industries (name, sector, price, release) from a Postgres database. Angular 22 page in `angular/`, .NET 10 API in `api_v2/`. Everything on the page saves to the database, and since today the team can change rules, add fields, go back to old versions, and ask a developer for help all from the page.

## Where things are right now

- Steps 1 to 7 are built, plus backups (batch 4). Step 8 (login) is built in batch 7. Restore from a backup is built in batch 8, https and the UI judge's list in batch 9.
- Batches 1 to 9 are all on main. Batches 8 and 9 came in from the `restore-from-backup` branch with the merge `e770068` (PR #1, 2026-10-07).
- My own Postgres (port 5432, database `api_v2`) is up to date. The `AddHistoryFieldsRequests` migration ran on 2026-10-05 at 12:12 with its copy saved first, 301 rows, nothing changed.
- The Docker database (port 5433, databases `main` and `collector`) has test data only: a fake old version #4, a custom field Ticker, a few imported rows, and some requests. Safe to wipe with `docker compose down -v`.
- Nothing of Claude's is running. Run `start.bat` to bring the API and the page up. The first start after batch 4 makes a backup in `backups/` in the project folder a few seconds after the API is ready.
- Builds are clean, `ng test` passes 32 of 32 in 9 files (rechecked 2026-10-07), and every batch was checked on throwaway databases and in the browser, see `testing/report.txt`.

## Waiting on me

- [x] Commit batches 6 and 7 (`17bfc53`)
- [x] Ran `start.bat` on 2026-10-07. The first start after batch 7 applies the `AddUsersAndSessions` migration on my own database (a copy is saved first) and prints the first admin password once in the API window. Write it down, sign in, pick a new one
- [x] Https is built (batch 9), `start.bat https`. Still yours: run `dotnet dev-certs https --trust` once, and use it on the Wi-Fi instead of plain http
- [x] Ran `start.bat` on 2026-10-07. The first start after batch 5 adds one rules version "Sector list from config.toml" on my own database (copy saved first). Expected, it happens once
- [ ] `Backup:Folder` stays local for now. Later, when there's a server, see what it can do that a PC can't
- [x] Commit steps 5 to 7, the .gitignore cleanup, and break test batches 1 to 3 (`b92d06b`)
- [x] Run `start.bat` so my own database updates (it already was, since 2026-10-05)
- [x] `ac2d450` stays as it is (old long message and Claude co-author line). It's on GitHub with 21 commits on top, so a rewrite means force pushing main for one message. Not worth it
- [x] `angular/public/dollar_sign_favicon.png` deleted (batch 9)
- [x] Commit `start.bat` and Docker (`75165b4`)
- [x] Commit steps 3 and 4 (`9497e93`)
- [x] Docker installed, first run on my own Postgres created `collector`

## What got built

### 1. Unique names
- [x] Names are unique no matter the capitals or extra spaces, checked in the API and by a database index on `lower(btrim(Name))`
- [x] The index skips rows with `DuplicateOf` set, so flagged imports can share a name
- [x] `app.spec.ts` fixed

### 2. Docker
- [x] `docker-compose.yml` runs Postgres 17 on port 5433 so it doesn't clash with a local Postgres on 5432
- [x] The API creates `main` and `collector` by itself on the first run, fresh clones start empty
- [x] No settings file needed, the API falls back to Docker. `appsettings.Development.example.json` is there for anyone using their own Postgres
- [x] `start.bat` starts Docker only when the API uses it (no settings file, or settings pointing at 5433)
- [x] `docker_setup.md` for the team, says Docker is optional

### 3. Collector
- [x] Full copy of the table goes to `collector` before a migration, a rules change, a restore, or an import. If the copy fails, the change doesn't happen
- [x] Every add, edit and delete gets logged with before and after. Adds, edits and deletes are refused if the log can't be written first
- [x] Rows are stored as JSON so old copies stay readable after the table changes

### 4. Rules in one place
- [x] Rules live in the `RuleVersions` table, every save is a new version
- [x] `GET /schema`, `PUT /schema`, `GET /schema/versions`
- [x] The page and the seed script read their limits from `/schema`

### 5. History page (`/history`)
- [x] View, Download as CSV, Pin
- [x] Restore after typing `RESTORE`, brings back that version's rows and rules
- [x] Bring back rows adds old rows as new rows with new ids, preview first with triangles, asks "The old data follows different rules than the table does now. Import it anyway?" when needed
- [x] Old values that don't fit today's type become `--` and get a red triangle (`LostFields`)
- [x] Old columns matching a custom field's name land in that field, other old columns make a developer request
- [x] Retention: keep the last N versions or remove ones older than N days, pinned always stay, empty keeps everything

### 6. Custom fields (`/fields`)
- [x] Change labels and limits, add custom fields, hide custom fields (data stays)
- [x] Custom values live in the row's `Extra` JSON column, so no migration needed
- [x] Changing a type or making a field a real column goes to a developer

### 7. Requests and the bell (`/requests`)
- [x] Bell in the nav with the open count, checked every 30 seconds and on every page change
- [x] Requests get made by the app for old columns, restores across layouts, type changes, and real column asks
- [x] Each one has the code drafted, with Show and Copy. Done, Dismiss, Reopen
- [x] The same open request never gets made twice

### 9. Restore from a backup (batch 8)
- [x] Restore next to every backup on History, admins only, type `RESTORE`. Rows, rules, retention and requests go back to that night, accounts and sign ins stay
- [x] The dump goes into a scratch database first (`main_restore_scratch`), then the four tables are swapped in one transaction with a binary COPY. A failed read never touches the live database, a failed swap rolls back
- [x] A backup from another table layout is refused before anything changes, its button is off with "Other table layout". `backup.json` records the migrations and the row count now
- [x] History page: the row count under each backup, the ask panel with the typed word, the result line, the "Before restoring the backup from ..." reason on the saved copy
- [x] Restore and Bring back from History write with one COPY, 10 minute limit. 100,000 rows in about 4 seconds
- [x] "History offline" after startup: every failed collector call marks it down at once, `HistoryMonitor` checks every 30 seconds and brings it back, the main page asks `/health` every 30 seconds
- [x] Failed backups and restores only show this code's own sentences (`BackupFailedException`), everything else goes to the log
- [x] Keep old versions refuses anything that isn't a whole number of 1 or more and sends nothing

How it was made: the box had no Docker daemon, so a Postgres 16 was started by hand on 5433 with the same user and password as `docker-compose.yml`, and the API built its own `main` and `collector` on first start. Every check was a small Python script against a throwaway API on 5104 (sign in, seed 300 rows, back up, change things, restore, compare), and the big table checks inserted 100,000 rows straight in SQL. The page was checked with a headless Chromium at 1280 and 390 wide and in dark mode. Then a race test: 30 rounds of three restores at once under 8 threads of adds, edits, deletes, bring backs, rules and retention saves and backups, plus 10 rounds on 20,000 rows, no errors and nothing stuck. Details in `testing/report.txt`.

### 10. Https, the page's own checks, and the UI judge's list (batch 9)
- [x] `start.bat https`: the API on https://localhost:7165 with the dev certificate, the page on https://localhost:4200, the page picks the https API from its own protocol. `Https:Required` turns the redirect from http and HSTS on, off by default. The API window warns at startup when nothing is https
- [x] Delete says what went: "Deleted 1 row from Industries: name" on the table, "Its values were removed from N rows in Industries" on Fields
- [x] The sign in back link only follows a page of this app, decoded too (E1). The token lives in memory when storage is blocked (E2, test). The interceptor's 401 and 403 rules have tests (E3). File names come out of Content-Disposition with filename* first and a fallback (E4). The settings file is refused on the page when it's over 1 MB, not JSON, a list or from another app (E6). The people page trims and lower cases, says to copy by hand when the clipboard is missing or refuses, and forgets the password when the page is left (E7). The account page stops a short, mismatched or reused password before any call (E8). The guest view and the guards have tests (E9, E10)
- [x] D1 problems under their own box with aria-describedby, the summary line only for answers from the API. D2 a long name ends with ... next to the pinned Actions column on a phone. D3 phone nav labels at 0.75rem, the plus and the account link icon only so seven fit in 390px. D4 the sign in card says Welcome back and sits in the middle of the page (rubric line updated to match, see the line below). D5 "300 rows" on the History cards on a phone. D6 no unit while a retention box is empty. D7 "Search by name" and "Show 10 entries" in sentence case. D8 contrast measured, dark red is #fda29b now (was 3.8:1 on amber) and disabled buttons go grey at full opacity (were 3:1). D9 "Delete <name>?" on a wide screen, the name on the button on a phone. D10 the Connected badge says what it means. D11 one focus ring in styles.css for links and everything else that had none. D12 a loading line on the Backups list
- [x] The unused dollar sign favicon is gone
- [x] No small label is in capitals anymore, and the questions before a delete or a turn off read "Are you sure you want to ...?"
- [x] The sign in and account pages are one card in the middle: the page title and its line are centred over it (`centered: true` in the route data, `.hero.centered` in app.css), the card is 30rem wide with 2rem inside, 1.25rem between the boxes, a full width button with room above it, and the "No account?" line centred 1rem under it. The hand on "Welcome back" waves once on load and on hover. On a phone the card keeps the page gutter, the name and the role stay on one line
- [x] A page left alone for 5 minutes starts from the top when the person comes back (`services/idle-top.ts`, a tab becoming visible, the window getting focus, or the first click, key or touch after the quiet spell), one jump, no animation

Graded against `testing/rubric_batches_8_9.md` (written by an Opus 5.5 critic, 10 criteria, pass at 7) from headless browser captures scored by a second critic: round 1 was 6 of 10 (one real defect on the account page, three capture gaps), round 2 was 9 of 10, a pass. Details in `testing/report.txt`.

How it was made: https was checked on the cloud box with the dev certificate (http answers 307 to https, https answers, the warning shows only when nothing is https). The edge cases are Vitest specs next to each file, 30 tests in 8 files. The design list was checked with `testing/contrast.py` (every pair 4.5:1 or better now) and `testing/check_design.mjs` in a headless Chromium at 390 and 1280 and in dark mode.

### Main table
- [x] Red triangle when a value couldn't come over, black for minor things, hover lists every reason
- [x] Amber row for similar rows, wrench on a column header when a developer was asked about it
- [x] Custom fields show as columns and as inputs in the form
- [x] Fixing a flagged row without renaming it keeps the flag, saving clears the red triangle, deleting the original row moves the flag to the next one

### Gitignore
- [x] Root `.gitignore` only lists what this project makes: `api_v2` build output, `appsettings.Development.json` (has the password), the seed script's `__pycache__`, root `.vscode/`, `report.txt`, the nightly `/backups/`, and the checks' `appsettings.Throwaway.json` and `testing/throwaway-backups/`. Angular keeps its own `angular/.gitignore`
- [x] `api_v2/.gitignore` removed, the root one covers it
- [x] `appsettings.json` is tracked now, it only has logging and no password
- [x] Root `.vscode/settings.json` untracked (it was just `{}`), the file stays on disk
- [x] Checked git history, no settings file or password was ever committed

## Issues we ran into

- **The name check wasn't case insensitive.** It compared with `==`, so `Atlas Steel` and `atlas steel` both got in. Fixed in the API and backed by the index.
- **Build failed while the API was running.** `dotnet build` can't overwrite `api_v2.exe` while it's in use. Stop the API first, then build or run `migrate.ps1`.
- **Ran the API with `--no-build` after adding a migration.** The new migration wasn't compiled in, so the API stopped with "pending model changes". It stopped safely and changed nothing. Always build after `migrate.ps1`.
- **Port 5432 was taken** by my own Postgres, so Docker uses 5433. pgAdmin needs the port changed to 5433 to see it, otherwise it tries my own Postgres with the Docker password and fails.
- **Both appsettings files are git ignored**, so a fresh clone had no connection string. The API falls back to Docker now.
- **The seed script had its own limits** in `config.toml`. After a rules change it would call good rows broken, so it reads `/schema` now.
- **Restoring a version with two rows sharing a name** can't keep them both. The API refuses and changes nothing, Bring back rows is the way for those.
- **Restore can't bring back old columns.** The API moves the database forward on every start, so old columns need a developer to change the code. A request with the steps gets made by itself.
- **Restoring old rules drops newer custom fields from the page, and their values.** Restore puts the old rows back, which never had those values, so they're gone from the table. Only the "Before restoring" copy has them. Found in the break test, see `Desktop/break_report.md`.
- **History actions got cut off** at laptop width and on phones. Fixed by putting the date under the description and turning rows into cards on phones.
- **Amber looks darker in dark mode.** 30% amber over near black comes out as a deep gold. It still stands out, can be brightened if the team wants.
- **PowerShell 5.1 adds a BOM** when saving, `config.toml` reading handles it.
- **The browser extension freezes on `confirm()` popups**, so Delete is never clicked during checks. Also why the custom delete popup is on the leftovers list.
- **History being down took the whole app down.** The collector was set up before the main database, so one unreachable collector meant no rows at all. Main comes first now, and only a waiting migration still needs the collector first.
- **"History offline" only knew about outages at startup.** Nothing set the flag back to false once it was true, so a collector that died mid run left the badge green. Every failed collector call marks it down now and a check every 30 seconds brings it back.
- **The restore scratch database came back dead the second time.** Npgsql pooled the connection to it, the forced drop killed that connection, and the next restore pulled the dead one out of the pool. The scratch connection doesn't pool anymore.
- **Restores of big tables hit the 30 second limit.** One INSERT per row, 100,000 rows meant 100,000 round trips. Restore and Bring back write with one binary COPY now, 100,000 rows take about 4 seconds.

## Still open

### Step 8, auth
- [x] `ICurrentUser` and `.RequireAdmin()` in `Auth/CurrentUser.cs`, used on rules, history and request status
- [x] Typed confirmation on Restore
- [x] Login with usernames and passwords (batch 7): People page for admins, bearer token sign ins, first admin made on first start, `Auth:ResetPassword` for a forgotten password, 5 tries a minute
- [x] Restore from a backup button, admin only (batch 8). It leaves Users and Sessions alone, loads the dump into a scratch database first, and swaps the four tables in one transaction. A backup from another layout is refused
- [x] Sector list from `config.toml` into the rules, and the API refuses other sectors (batch 5)
- [x] Settings Export and Import on the History page (batch 7), retention and the field labels and limits

### Break test (2026-10-05)
- [x] 37 findings in `Desktop/break_report.md`, ranked, with how each one was made
- [x] Batch 1 (races, error handling) and batch 2 (name rules, unchecked text) fixed and tested, committed in `b92d06b`
- [x] Batch 3 (2026-10-06), gaps the verify run found: Fields save checks the version it started from, the page opens while history is down ("History offline" badge), adds are logged before saving (finding 15), repeat requests keep their new details, column labels refuse line breaks. Committed in `b92d06b`
- [x] Batch 4 (2026-10-06): nightly backups with a Back up now button and downloads on History, and the sector dropdown. Committed in `5d7ff11`
- [x] Batch 5 (2026-10-06): queue fields and Send fields once, Delete for page made fields (built in ones stay), sector list from `scripts/config.toml` enforced by the API. Committed in `5d7ff11`
- [x] Batch 6 (2026-10-06): restore all or nothing, retention keeps the source version, failed restore/import leaves no copy, damaged versions marked, fuller change log, retention preview, strict numbers, custom values kept on update, 1000 character default for custom text, 4 decimal places. Details in `testing/report.txt`

- [x] Batch 7 (2026-10-06): Settings export and import, login, field keys keep letters from any language, the Actions column stays pinned on a wide table, and the fixes a UI judge asked for (darker faint grey, readable amber rows, the nav fits at 390px, plain words, one red style for dangerous buttons)

### Leftovers
- By design: restore brings back rows and rules but not old columns, that part stays a developer request
- [x] API address moved to `angular/src/environments/environment.ts`, CORS origins come from `Cors:Origins` in `api_v2/appsettings.json`
- [x] Delete asks inside the row now, no browser popup
- [x] The API only retried for about 30 seconds on start. It keeps retrying every 30 seconds now and says which database is down

## Where to look

| What | Where |
|---|---|
| Rules and their checks | `api_v2/Rules/RulesService.cs`, `FieldRule.cs` |
| Collector copies, logs, retention | `api_v2/Data/CollectorStore.cs` |
| Restore and import, old to new conversion | `api_v2/History/TableWriter.cs` (`ColumnRenames` for renamed columns) |
| History, requests, schema endpoints | `api_v2/Endpoints/` |
| Drafted code for requests | `api_v2/Requests/Drafts.cs` |
| Login, sessions, roles | `api_v2/Auth/` (`CurrentUser.cs`, `UserService.cs`, `PasswordHasher.cs`), `api_v2/Endpoints/AuthEndpoints.cs`, `UserEndpoints.cs`, page side `angular/src/app/services/auth.ts` |
| Backups and restoring one | `api_v2/Backups/BackupService.cs` (pg_dump, the list, pruning), `BackupRestore.cs` (pg_restore into a scratch database, the swap), `api_v2/Endpoints/BackupEndpoints.cs` |
| History going offline and back | `api_v2/Data/HistoryMonitor.cs`, `CollectorStore.NoteFailure` |
| Pages | `angular/src/app/Components/` (my-components is the table, plus history, fields, requests) |
| Colors, including the amber | `angular/src/styles.css` |
| The checks and how to run them safely | `testing/README.md` |
| Team setup | `README.md`, `docker_setup.md`, `Desktop/server.md` for sharing my Docker server on Wi-Fi |

## Decisions

### Rollback and moving forward
- Old data goes to the separate `collector` database so nothing gets lost
- Old data only comes back when someone restores or brings it back by hand, never by itself
- How it turned out: restore brings back rows and rules, the columns follow the code, so going back to old columns is a developer job

### Import rules
- Import only adds, it never replaces
- Imported rows get the next free id
- If the old data follows different rules, ask: "The old data follows different rules than the table does now. Import it anyway?" with Import anyway and Cancel
- Length or limit differences get accepted and get a black triangle
- A renamed column needs a developer, it goes through a request
- A changed data type gets converted when possible, anything that can't be converted shows `--`
- Duplicate names are allowed only through import, and get flagged

### Names
- A name can only be used once in the regular table, no matter the capitals or spaces, adding or editing a taken name returns 409
- The same name twice means the same company

### Warning triangles
| Color | When |
|---|---|
| red | a value couldn't come over from the old data and shows `--` |
| black | the row breaks a current length or limit rule |
| black + amber row | a similar row exists, hover says "A similar row exists in this table in row #45" |
| wrench on the column header | the column is waiting for a developer |

- A row with several problems shows one triangle in its most serious color, hovering lists all of them
- Triangles go away once the problem is fixed, renamed, deleted or set up
- Black triangles turn white in dark mode

### Similar row color
- Amber, the only row color in the black and white design
- Light mode: `#f59e0b` at 30% background, solid `#d97706` 3px left edge
- Dark mode: `#fbbf24` at 30% background, solid `#fbbf24` 3px left edge
- Tokens `--similar-bg` and `--similar-edge` in `styles.css`

### Wording
- Everything the team sees is plain words, no technical terms

### Restore from a backup
- Scratch database first, never pg_restore straight into the live one. pg_restore runs as its own program with its own connection, so it can't join a transaction. Loading into a scratch copy and then moving rows over from our own connection is what makes the swap all or nothing
- Only Industries, RuleVersions, Requests and Settings come back. Users and Sessions are left alone on purpose, a restore must never hand out an old password or sign everyone out. The history database isn't restored from the page either, it only grows and restoring it would drop the versions saved since
- The dump's own `__EFMigrationsHistory` decides if the layout matches, `backup.json` is only the quick check that turns the button off. A different layout is refused, the same rule as an old saved version
- A copy of the table goes to History before the swap and is deleted again if the swap fails, the same as Restore from a version
- The scratch connection doesn't pool and gets a 10 minute command timeout. Pooled connections to a database that gets dropped with FORCE come back dead

### Commits
- Only I commit and push. Claude writes the message: one plain line plus `Contributor: opus 5.5`, no co-author line
