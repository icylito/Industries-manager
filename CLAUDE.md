# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Stock Listing: an Angular 22 page (`angular/`) and a .NET 10 minimal API (`api_v2/`) over Postgres, for a team that keeps a
table of industries. Read `README.md` first (what it does, the pages, the roles, where files go). `HANDOFF.md` and
`OVERVIEW_HANDOFF.md` carry the history and the briefs, `docs/plans/` holds dated plans, `testing/README.md` explains the
check scripts. This file is only what needs several files to see.

## Commands

Run from the repo root unless a folder is named. `start.bat` starts the API and the page in two windows (`start.bat https`,
`start.bat share` for other devices).

| Task | Command |
|---|---|
| API (port 5005) | `cd api_v2 && dotnet run --launch-profile http` |
| Page (port 4200) | `cd angular && npx ng serve` |
| Database | `docker compose up -d` (Postgres 17 on **5433**). With no `ApiV2` connection string the API uses it. |
| Build | `cd api_v2 && dotnet build` and `cd angular && npx ng build` |
| All page tests | `cd angular && npx ng test --watch=false` |
| One page test file | `cd angular && npx ng test --watch=false --include src/app/Components/history/history.spec.ts` |
| New migration | `cd api_v2 && .\migrate.ps1 -Context Data -Name Something` (or `-Context State`). The API applies it on its next start. |
| Seed rows | `python scripts/seed_industries.py` (settings in `scripts/seeding.toml`, login in the git ignored `scripts/seeding.control.toml`) |
| API and page checks | `python3 -I testing/check_<name>.py`, see `testing/README.md` |

There is no linter configured. After `package.json` changes run `npm ci` in `angular/`, a stale `node_modules` fails the
build with a missing font file.

`api_v2/appsettings.Development.json` holds the database password and is git ignored. Never create or edit it, copy
`appsettings.Development.example.json` if it is missing.

## Architecture

**Three places data lives.** The main database (the live tables), the **collector** database (History: `versions`,
`version_rows`, `row_changes`, read and written with plain SQL in `Data/CollectorStore.cs`, its schema is made by
`EnsureSchemaAsync`, not by EF), and folders on disk (`backups/`, `scratchpad-files/`, `user-tables/`, `backup-key/`,
all git ignored). `DatabaseStatus` tracks whether each is reachable and `/health` reports it.

**Two migration chains, and which one a change belongs to matters.** `Data/DataModel.cs` is what **travels in time**:
industries, rules, the Tables page. Restoring a version or a backup rolls these back. `Data/StateModel.cs` is what is
**always current**: accounts, sessions, notes, personal settings, the Scratchpad, requests, app settings. A restore never
touches them. Each has its own EF context, folder (`Migrations/`, `Migrations/State/`) and history table
(`__EFMigrationsHistory`, `__StateMigrationsHistory`). `Data/MigrationService.cs` applies both on startup. Before it
changes an existing database it saves a full copy into the collector, and it moves old steps from the data history to the
state history. The app itself reads and writes through `AppDbContext`, which has both parts.

**Changes take turns through advisory locks** (`Data/AppLocks.cs`, `AppLock.Table`, `Rules`, `Settings`, `Scratchpad`...).
Restore and import hold the table lock, so concurrent ones queue instead of failing. A lock that can't be taken becomes
`AppBusyException`, answered 503.

**Restore and import are different on purpose.** `History/TableWriter.PlanAsync` fits an old version's rows into today's
columns and rules. Restore swaps the whole table in one transaction (rows, rules and a developer request together) after
saving a copy of the current table. Import only adds rows as new ids. A name that is already in the table is not refused:
it comes in as a flagged copy (`DuplicateOf`), so the import API makes the caller say skip or keep.

**Rules live in the database, not in code.** Field labels, limits and custom fields are versioned in `RuleVersions` and
served by `GET /schema` (`Rules/RulesService.cs`). Custom field values sit in `Industries."Extra"`. The page reads the
rules and the API checks them again, so a page is never the only guard.

**One name rule everywhere.** Two names are the same when they match ignoring case, accents, spaces, punctuation and
symbols, by ICU. It exists three times, kept in step by hand: the Postgres collation `name_rule`, `api_v2/Rules/Names.cs`,
and `angular/src/app/services/name-key.ts`. `testing/check_names.py` holds the shared examples.

**Auth** is a Bearer token kept in `localStorage` (`stock-listing-token`), attached by `services/auth.interceptor.ts`.
Anyone can browse. Endpoint groups choose `RequireViewer`, `RequireManager` or `RequireAdmin` (`Auth/CurrentUser.cs`) and
`RequireDatabaseReady` (`Endpoints/SchemaEndpoints.cs`). Route guards are in `angular/src/app/guards.ts` and must agree
with the endpoint groups.

**Errors.** Every exception goes through `Errors/ApiExceptionHandler.cs`: `Describe` maps it to a status and a plain
sentence, expected ones (bad input, name taken, concurrent change, busy) log one line, only the unexpected log a stack.
`RouteHandlerOptions.ThrowOnBadRequest` is on, so bad JSON reaches it as `BadHttpRequestException`.

**The Scratchpad** keeps each board as one JSON document validated by `Scratchpad/BoardRules.cs`. The client engine is
`angular/src/app/board/` (pure `ops`, `geometry`, `tools`, plus stores). The carry tray from the Overview is server side
(`/scratchpad/tray`), uploaded files live on disk under `scratchpad-files/` with a sweeper that removes unused ones.

## Pairs of files that must change together

| One side | The other side |
|---|---|
| `angular/src/app/models/board.ts` | `api_v2/Scratchpad/BoardRules.cs` (the board shape) |
| `HistoryPage.noteMax` in `history.ts` | `HistoryEndpoints.NoteMax` (the restore note limit, 300) |
| `angular/src/app/services/name-key.ts` | `api_v2/Rules/Names.cs` and the `name_rule` collation |
| A model in `api_v2/Model/` or `Data/*Model.cs` | an EF migration in the right chain, and the TS type in `models/industry.ts` |
| A route in `app.routes.ts` | its guard, and the `Require*` on the endpoint group |

## Things that bite

- **Request bodies declared inside `Endpoints/*.cs` are not validated by `AddValidation()`**, only the ones in `Dtos/`
  are. Every free text field there needs a hand written length check, the one that lacked it was found by the History
  stress test. JSON bodies are capped at 2 MB (`Http:MaxRequestBodyKb`), uploads raise their own limit on the request.
- `GET /industries` returns the whole table, and Browse and Overview compute everything from it in the browser. Fine at
  tens of thousands of rows, see Phase 2 below. The Scratchpad uses `/industries/search`, `/top` and `/by-ids` instead.
- A restore brings back rows and rules, not old columns. That is by design, old columns are a developer request.
- The checks in `testing/` delete rows. `testing/t.py` refuses the API on 5005 or 7165 and any database called `main`,
  `collector` or `api_v2`, so run them against a throwaway API on 5104 only.
- Comments in this repo are plain sentences about intent and the reason, not labels. Match that.
- Commit only when asked, as one plain line in the owner's lowercase style with a `Contributor:` trailer, no co-author line.

## Current plan

Full text: `docs/plans/2026-10-11-history-hardening.md`.

| Phase | What | State |
|---|---|---|
| 1 | History hardening: restore note capped at 300 (page, API, storage), import must say skip or keep on duplicates, response compression and a 2 MB body cap, expected errors logged as one line | **Built**, commit `419491d`. Page tests and both builds pass, checked by hand against a copy of the data. |
| 1b | Run `testing/check_history_limits.py` on a throwaway API | **Not run yet**, needs the setup in `testing/README.md` |
| 2 | Server side paging: `GET /industries/page`, `/industries/summary`, `/industries/export`, then move Browse and Overview onto them and drop the full list call | **Design only, needs its own approval.** Start when the table nears about 100,000 rows or the compressed list passes about 5 MB. Order: summary, paged list, export. |
