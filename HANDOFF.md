# Handoff: Stock Listing (icylito/Minimal-APi)

Written 2026-10-07 at the end of a Claude Code cloud session. Read this first, then `plan.md` and `report.txt` (both in the repo root) for the full project history.

## The project in two lines

Angular 22 page (`angular/`) and .NET 10 minimal API (`api_v2/`) over Postgres. It lists industries. The team can change rules, add fields, restore old versions and backups, and ask a developer for help, all from the page. Login and roles are built (batch 7). Restoring from a backup and https are built (batches 8 and 9).

## Where git stands

| Branch | Head | State |
|---|---|---|
| `main` | `e770068` | Merge of PR #1 (`restore-from-backup`, batches 8 and 9). Everything built so far is here |
| `claude/nice-franklin-mckat2` | `48fc4b5` | Two commits on top of main, open as **draft PR #2**: https://github.com/icylito/Minimal-APi/pull/2. The user keeps this branch for cloud sessions |
| `restore-from-backup` | `35163d2` | Already merged. Left on GitHub, nobody deleted it |

**PR #2** (not merged yet, the user merges it):
- **Checks use throwaway databases.** `testing/` now uses `throwaway_main` and `throwaway_collector` instead of `main` and `collector`. `stress.py` used to `DELETE FROM "Industries"` on the same Docker database `start.bat` uses.
- **Safety stops in `testing/t.py`.** It refuses API ports 5005 and 7165, refuses the real database names, and requires `ADMIN_PASSWORD`, which has no default anymore.
- **Settings and setup work on Windows.** `testing/appsettings.Throwaway.example.json` has no Linux paths, and `testing/README.md` has new setup steps.
- **Notes match main.** `plan.md` and `report.txt` were updated after the merge.
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

2. **Admin overview page (waiting on a design).** The user wants a page for admins with numbers from the table: a pie chart of how the rows split across sectors, the biggest markets, and the top 3 most expensive stocks. Claude Design is making the design and the user will share it, so don't build it before that.

## Done on 2026-10-07 (local session)

- **Docker on the Wi-Fi.** The database listens on this PC only by default (`"${DB_BIND:-127.0.0.1}:5433:5432"`). `start.bat share` opens only the page, over https. The page server passes `/api` on to the API (`angular/proxy.share.json`), the API and the database stay on this PC. `start.bat share db` also opens the database. The API reads `X-Forwarded-For` from loopback, so sign in limits count per device. See README, Sharing on the Wi-Fi.
- **Checked:** page, `/api` and sign in from the PC's Wi-Fi address (192.168.1.45). The API on 7165 and the database on 5433 refuse from that address. A real phone or coworker PC wasn't tried by Claude. The Wi-Fi was set to **Public** in Windows, which blocks other devices until the user switches it to Private.
- **Commit footer.** Settled: `Contributor: opus 5.5`, as `plan.md` says.
- **Https.** The dev certificate was already trusted on the user's PC. `start.bat https` and `share` now copy it to `angular/.cert` (git ignored) and the page uses it, so `https://localhost:4200` opens with no warning. Other devices still get a warning, the certificate is for `localhost`.

## How the user works

- **Messages to the user.** Plain words, short. Push back with facts when they're wrong. Say what you verified separately from what you assumed. If something fails or times out, stop and say so, don't quietly retry.
- **Commits.** One plain lowercase line describing what changed, then `Contributor: opus 5.5`. No co-author line.
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
- **Where things are.** The table in `plan.md` under "Where to look" maps each feature to its files.

## A check-in already set by the last session

That session set a one-time reminder in *its own* session to re-check PR #2 at about 09:29 UTC on 2026-10-07 (trigger `trig_01Y1tsVQ9F7rG5vAFikoTJ5e`). It doesn't reach a new session. To have a new agent watch PR #2, subscribe to it from the new session.
