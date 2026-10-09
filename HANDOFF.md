# Handoff: Stock Listing (icylito/Minimal-APi)

Written 2026-10-07 at the end of a Claude Code cloud session. Read this first, then `report.txt` (in the repo root) for the full project history. `plan.md` used to sit beside it and is not in the repo any more, so where something below points at the build history behind it, read `report.txt` or `git log`.

## The project in two lines

Angular 22 page (`angular/`) and .NET 10 minimal API (`api_v2/`) over Postgres. It lists industries. The team can change rules, add fields, restore old versions and backups, and ask a developer for help, all from the page. Login and roles are built (batch 7). Restoring from a backup and https are built (batches 8 and 9).

## The Scratchpad (next session, its own project)

A place for an admin to **think with their industries**: pull a few industries onto a board, put notes around them, draw arrows between the ones that belong together, and come back tomorrow to find it as they left it. It is not a report and not a database view. It should feel like a table with paper on it, quick and forgiving, with nothing to learn.

**Update 2026-10-09: built**, on the `scratchpad-canvas` branch: the canvas, select several, groups, rich text, lines, the save pill, the rail, files and pictures (item e), the carry tray with snapshots, and the Mouse rows in the shortcuts panel (item g). The latest state, what was checked and what is still open, is at the end of `OVERVIEW_HANDOFF.md`. The paragraphs below are the original brief, kept for the intent.

**Where the design lives.** `design/Scratchpad-Light.dc.html` is the board. `design/README.md` says how to read the `.dc.html` files. The Scratchpad part of `OVERVIEW_HANDOFF.md` is the real brief: the intent, the user's items a to g, and the two round-two tables that say what the board fakes and what to build properly. Where the board and the handoff disagree, the handoff wins. The root copy of `OVERVIEW_HANDOFF.md` is the same file as `design/OVERVIEW_HANDOFF.md`, both are tracked.

**Confirm before building the model.** Storage and the model are approved in principle (Scratchpad boards, shortcut changes and saved views, the light or dark choice, and uploaded files, all saved per person). Still needing the user's yes: the **table and field names**, the **25 MB file limit, which is a placeholder the user has never chosen**, and the **migration**, which is required. `model-change-needs-migration` applies: show the user the model change and the migration before running it.

**Build order the user asked for.** Their items a, b, d, then c, f, g, and **e (files) only after they confirm file storage**. a is the endless canvas, pan and zoom. b is selecting several things at once. d is bold and highlight on selected words. c is grouping under a label. f is better lines, in the order label, arrowhead, then a gentle curve. g is the customised controls, which need the Scratchpad scope and the Mouse group in the shortcuts panel. e is dragging things in, which is where the file storage question sits.

**Essential, do not ship without it: undo and redo.** `Ctrl+Z`, and `Ctrl+Y` or `Ctrl+Shift+Z`, covering deletes, moves, drawings and typing, and also while a note has focus. This is why nothing on that page asks "are you sure". The user's words, 2026-10-07. The board has `OPUS:` comments at the undo code.

**The rest of the feel to keep.** A line glued to two cards stays glued when either card moves. New things appear in free space, never on top of something else. Saved per person automatically, with no Save button, and a small "Saved" note is enough. The board keeps its position and zoom, so coming back tomorrow shows the same view.

**Closed, do not build.** The "Apply anyway" button, which would keep one key on two functions. The user decided against it on 2026-10-07. The reason to give if it comes back: two functions on one key needs a "which one runs" rule that people would have to learn.

**Refused.** Word, PowerPoint and Excel files, with the plain message "Word, PowerPoint and Excel files can't go on the board." Everything else the user named is allowed, which is images, GIFs, video, PDF and anything else. **Executables and SVG are the implementer's call**, because the design leaves them open: the board will not preview an SVG since it can carry script. Video and GIF show as a plain card for now; a player is the implementer's call. Do not widen this list without asking.

**What existed when this was written (2026-10-07, now built, see the update above).** No Scratchpad code, route, service or tab anywhere in the repo. The two hooks already waiting for it: the comment in `app.html` beside the admin tabs ("The Scratchpad joins these tabs when that page is built"), and `shortcuts.ts`, where `ADMIN_PAGES` holds one entry and the `Scope` union lists the scopes.

**What it inherits.** Overview and Settings are the admin tabs. History and Fields are on the normal nav, behind `adminGuard`. People, Rename, admin notes and Delete account live inside Settings, and `/users` redirects there. The Scratchpad becomes a third admin tab behind `adminGuard`, adds itself to `ADMIN_PAGES`, and adds a scratchpad scope to the shortcuts. `app.spec.ts` pins the admin tabs to exactly `['Overview', 'Settings']`, so the new tab changes that assertion. Shortcut changes are saved per person on the server, so this needs a table and a migration too, and the Scratchpad must read the customised keys. The database is the user's own PostgreSQL 18, with `main` and `collector`.

**Two faults this file used to carry, corrected on 2026-10-08.** It used to send the reader to a `plan.md` that is not in the repo, and it used to say the Overview page awaited a design. The Overview is built and committed, and the pointers to `plan.md` now say where that material went, so read the note above and the "Where things are" line near the bottom before you follow any older pointer you find elsewhere.

## Where git stands

**This table is from 2026-10-07 and is out of date.** Main has moved on since, and the Scratchpad work is on `scratchpad-canvas`. Check `git log` and `git branch -a` before trusting any head or PR state below.

| Branch | Head | State |
|---|---|---|
| `main` | `e770068` | Merge of PR #1 (`restore-from-backup`, batches 8 and 9). Everything built so far is here |
| `claude/nice-franklin-mckat2` | `48fc4b5` | Two commits on top of main, open as **draft PR #2**: https://github.com/icylito/Minimal-APi/pull/2. The user keeps this branch for cloud sessions |
| `restore-from-backup` | `35163d2` | Already merged. Left on GitHub, nobody deleted it |

**PR #2** (not merged yet, the user merges it):
- **Checks use throwaway databases.** `testing/` now uses `throwaway_main` and `throwaway_collector` instead of `main` and `collector`. `stress.py` used to `DELETE FROM "Industries"` on the same Docker database `start.bat` uses.
- **Safety stops in `testing/t.py`.** It refuses API ports 5005 and 7165, refuses the real database names, and requires `ADMIN_PASSWORD`, which has no default anymore.
- **Settings and setup work on Windows.** `testing/appsettings.Throwaway.example.json` has no Linux paths, and `testing/README.md` has new setup steps.
- **Notes match main.** The notes that came with that merge are in commit `5fc2430`, which updated them in the same pass as the checks.
- **Cleanup commit.** `48fc4b5` removes `.pyc` files the first commit added by mistake.
- **No CI, no reviews.** The repo has no CI checks, and PR #2 had no reviews when this was written.

## What was decided this session (don't re-ask)

- **`ac2d450`:** leave it. Rewriting it means force pushing main for one commit message.
- **Restoring old columns:** a restore brings back rows and rules but not old columns, and that's by design. Old columns stay a developer request.
- **Delete looking loud on a big table:** handled in batch 9.
- **The UI critic's leftover list:** skipped for now. If design comes back, the one worth doing is the sticky nav covering the Fields page title. See `report.txt`.
- **The `testing/` check suite:** keep it, don't delete it.
- **The batch 9 design and edge-case brief (D1 to D12, E1 to E10):** done. The user says the sections Fable 5 was asked to do were done.
- **`start.bat`:** the user ran it on 2026-10-07 and will run it again after pulling main.

## Waiting on the user

1. **Merge PR #2.** On 2026-10-07 the local session merged it into local `main` (a fast-forward) but couldn't push `main`. The user pushes it or merges the PR on GitHub. The user also took the branch ruleset off GitHub for now and will put it back later.

2. **Admin overview page: additions (waiting on a design).** The Overview page itself is built and committed: `/overview`, behind `adminGuard`, and the first tab in the admin nav. What the user still wants added to it is more numbers from the table: a pie chart of how the rows split across sectors, the biggest markets, and the top 3 most expensive stocks. Claude Design is making the design for those additions and the user will share it, so don't build them before that. The Scratchpad is the other half of that design work, see the section at the top of this file.

## Done on 2026-10-07 (local session)

- **Docker on the Wi-Fi.** The database listens on this PC only by default (`"${DB_BIND:-127.0.0.1}:5433:5432"`). `start.bat share` opens only the page, over https. The page server passes `/api` on to the API (`angular/proxy.share.json`), the API and the database stay on this PC. `start.bat share db` also opens the database. The API reads `X-Forwarded-For` from loopback, so sign in limits count per device. See README, Sharing on the Wi-Fi.
- **Checked:** page, `/api` and sign in from the PC's Wi-Fi address (192.168.1.45). The API on 7165 and the database on 5433 refuse from that address. A real phone or coworker PC wasn't tried by Claude. The Wi-Fi was set to **Public** in Windows, which blocks other devices until the user switches it to Private.
- **Commit footer.** The footer names **whoever did the work**, it is not pinned to one agent's name. Every commit since `bf51b5e` says `Contributor: deepseek flash`, and older ones name the agent of their day, so copy what your own work should say and do not carry a stale name forward.
- **Https.** The dev certificate was already trusted on the user's PC. `start.bat https` and `share` now copy it to `angular/.cert` (git ignored) and the page uses it, so `https://localhost:4200` opens with no warning. Other devices still get a warning, the certificate is for `localhost`.

## How the user works

- **Messages to the user.** Plain words, short. Push back with facts when they're wrong. Say what you verified separately from what you assumed. If something fails or times out, stop and say so, don't quietly retry.
- **Commits.** One plain lowercase line describing what changed, then a footer naming whoever did the work (`Contributor: deepseek flash` for the agent that wrote it). No co-author line.
- **Wording on the page.** Plain words, no technical terms. Colours only from the CSS variables in `angular/src/styles.css`.
- **Line endings.** Files in `angular/src` use Windows line endings (CRLF). Keep them.
- **Branch and merge rules.** Work on `claude/nice-franklin-mckat2`, push it, open a draft PR into `main`. The user merges, or asks you to.
- **`report.txt`.** It's listed in `.gitignore` but tracked, so edits to it still get committed.

## Cloud environment gotchas (found the hard way)

- **The .NET SDK can't be installed.** The network policy blocks `builds.dotnet.microsoft.com`, so the API can't be built or run in the cloud box. Say so when a claim depends on it.
- **The Angular CLI refuses Node 22.22.0.** Use Node 24 through npx:
  ```
  NODE24=$(npx -y node@24 -e "console.log(process.execPath)")
  cd angular && npm ci
  $NODE24 node_modules/@angular/cli/bin/ng.js build
  CHROME_BIN=/opt/pw-browsers/chromium $NODE24 node_modules/@angular/cli/bin/ng.js test --watch=false
  ```
  On `main`: the build is clean, and 32 tests pass in 9 files.
- **Deleting a branch on GitHub fails from the box.** `git push --delete` got cut off by the proxy, so ask the user to do it on GitHub.
- **`playwright` isn't installed,** so the `.mjs` page checks can't run as-is.
- **Python leaves compiled files behind.** `python3 -m py_compile` writes `__pycache__` folders, so check `git status` before `git add -A`.

## Worth knowing in the code

- **Restore from a backup** (`api_v2/Backups/BackupRestore.cs`):
  - The dump is loaded into a scratch database first, `main_restore_scratch`.
  - The four tables are swapped in one transaction with a binary COPY.
  - Users and Sessions are never restored.
  - The scratch database name is fixed, so two APIs restoring on the same Postgres server at the same moment would collide.
- **The page checks call the API on 5005.** The page always calls 5005 (`angular/src/environments/environment.ts`). So the `.mjs` checks need the throwaway API on 5005, with `start.bat`'s API closed. `testing/README.md` says so.
- **Where things are.** `plan.md` used to map each feature to its files under "Where to look". It is not in the repo any more, so use `report.txt` and `git log`, or ask the user.

## A check-in already set by the last session

That session set a one-time reminder in *its own* session to re-check PR #2 at about 09:29 UTC on 2026-10-07 (trigger `trig_01Y1tsVQ9F7rG5vAFikoTJ5e`). It doesn't reach a new session. To have a new agent watch PR #2, subscribe to it from the new session.
