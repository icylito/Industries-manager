# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Stock Listing: an Angular 22 page (`angular/`) and a .NET 10 minimal API (`api_v2/` hosts it, the layers are in
`backend/`) over Postgres, for a team that keeps a
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
| Database | `docker compose up -d` (Postgres 17 on **5433**). `appsettings.Development.json` points at it in this copy; change the two strings there to `5432` to use your own Postgres instead. |
| Build | `dotnet build api_v2.slnx` and `cd angular && npx ng build` |
| API tests | `dotnet test api_v2.slnx` (layer rules, unit tests and the smoke run). The smoke run needs Postgres on 5433, `SMOKE_PG` names another server; `--filter Category!=Smoke` skips it |
| Page layer check | `cd angular && npm run lint:layers` (dependency-cruiser, rules in `angular/.dependency-cruiser.cjs`) |
| All page tests | `cd angular && npx ng test --watch=false` |
| One page test file | `cd angular && npx ng test --watch=false --include src/app/presentation/components/history/history.spec.ts` |
| New migration | `cd api_v2 && .\migrate.ps1 -Context Data -Name Something` (or `-Context State`). It runs the pinned `dotnet-ef` from `dotnet-tools.json` against `backend/Infrastructure` with `api_v2` as the startup project. The API applies it on its next start. |
| Seed rows | `python scripts/seed_industries.py` (settings in `scripts/seeding.toml`, login in the git ignored `scripts/seeding.control.toml`) |
| API and page checks | `cd testing && python3 -I check_<name>.py`, see `testing/README.md` |
| Throwaway API for the checks (port 5104) | copy `testing/appsettings.Throwaway.example.json` to `api_v2/appsettings.Throwaway.json`, then in `api_v2`: `set ASPNETCORE_ENVIRONMENT=Throwaway` and `dotnet run -c Release --no-launch-profile --urls http://localhost:5104` |

The only lint is the page's layer check above. The page has a Prettier config (`angular/.prettierrc`: width 100, single quotes, the
Angular parser for HTML), run it on the files you touch with `cd angular && npx prettier --write <file>`. After `package.json` changes run `npm ci` in `angular/`, a stale `node_modules` fails the
build with a missing font file.

`api_v2/appsettings.Development.json` holds the database password and is git ignored. Never create or edit it, copy
`appsettings.Development.example.json` if it is missing.

## Architecture

**Four layers, four projects, and the arrows point inward.** Each layer of the API is its own project under `backend/`,
so a reference the wrong way doesn't compile, and `backend/Tests/Architecture/LayerRules.cs` fails on a framework
package a layer has no business with.

| Project | Holds | May reference |
|---|---|---|
| `backend/Domain` | entities and pure rules (names, fields, boards, tables, file kinds) | nothing, not even a package |
| `backend/Application` | use cases, the ports in `Ports/`, result records, the settings records in `Settings/AppOptions.cs`, the work of the background jobs in `Jobs/` | Domain, and the logging and DI abstractions |
| `backend/Infrastructure` | EF and both migration chains, stores, SQL, files, crypto, backups, the timers in `Hosted/`, the one place appsettings is read (`DependencyInjection.cs`) | Application, EF, Npgsql, ASP.NET |
| `backend/Presentation` | endpoints, contracts, the sign in filters, the error answers | Application only |
| `api_v2` | `Program.cs`, the composition root: logging, CORS, Kestrel limits, compression, https, OpenAPI, then `AddApplication`, `AddInfrastructure`, `AddPresentation` | Presentation and Infrastructure |

A path below that starts with `Domain/`, `Application/`, `Infrastructure/` or `Presentation/` is under `backend/`.

An endpoint binds input, calls one use case, and maps the answer to a `Results.*`; it never takes a lock, builds an
entity or touches a file. Entities never cross the wire either way: a body is a contract in `Presentation/Contracts/`
(the smoke run checks no endpoint takes an entity). A use case asks for a port; the class behind it lives in
Infrastructure and is wired in `backend/Infrastructure/DependencyInjection.cs`. What the database refused (name taken,
changed meanwhile, too long) is read by `IStorageErrors`, so the error handler knows HTTP and nothing about Postgres.

The page has the same four folders under `angular/src/app/`. `application/ports/` holds the ports as abstract classes
(`IndustryGateway`, `TablesGateway`, `ScratchGateway`, `AuthGateway`, `ProfileGateway`, `SettingsGateway`, `TokenStore`)
and `ApiFailure`, the shape of a failed call; `infrastructure/` implements them and `infrastructure/providers.ts` wires
them, used by `app.config.ts` and by every spec that builds a test module. Components and use cases inject ports, never
`IndustryApi` and friends, and never import `@angular/common/http`. The domain imports nothing, not even Angular: the
board tools work against `domain/board/editor.ts`, which the board engine implements. `npm run lint:layers` fails on
any of it. When adding a feature, put the rule in the domain, the order of the steps in an application use case, the
database or HTTP work behind a port, and the request shape in an endpoint plus a contract.

**Three places data lives.** The main database (the live tables), the **collector** database (History: `versions`,
`version_rows`, `row_changes`, read and written with plain SQL in `backend/Infrastructure/Persistence/CollectorStore.cs`, its
schema is made by `EnsureSchemaAsync`, not by EF), and folders on disk (`backups/`, `scratchpad-files/`, `user-tables/`,
`backup-key/`, all git ignored). `DatabaseStatus` (`Application/Health/DatabaseStatus.cs`) tracks whether each is
reachable and `/health` reports it.

**Two migration chains, and which one a change belongs to matters.** `Infrastructure/Persistence/DataModel.cs` is what
**travels in time**: industries, rules, the Tables page. Restoring a version or a backup rolls these back.
`Infrastructure/Persistence/StateModel.cs` is what is **always current**: accounts, sessions, notes, personal settings,
the Scratchpad, requests, app settings. A restore never touches them. Each has its own EF context, folder
(`Infrastructure/Persistence/Migrations/`, `Migrations/State/`) and history table (`__EFMigrationsHistory`,
`__StateMigrationsHistory`). `Infrastructure/Startup/MigrationService.cs` applies both on startup. Before it changes an
existing database it saves a full copy into the collector, and it moves old steps from the data history to the state
history. The app itself reads and writes through `AppDbContext`, which has both parts.

**Changes take turns through advisory locks** (`Application/Ports/AppLock.cs` for the keys,
`Infrastructure/Persistence/AppLocks.cs` for the database side: `AppLock.Table`, `Rules`, `Settings`, `Scratchpad`...).
Restore and import hold the table lock, so concurrent ones queue instead of failing. A lock that can't be taken becomes
`AppBusyException` (`Application/Exceptions/`), answered 503.

**Restore and import are different on purpose.** `Infrastructure/Persistence/TableWriter.cs` (behind
`Application/Ports/ITableWriter.cs`) fits an old version's rows into today's columns and rules. Restore swaps the whole
table in one transaction (rows, rules and a developer request together, in
`Infrastructure/Persistence/HistoryRestoreRunner.cs`) after saving a copy of the current table. Import only adds rows as
new ids. A name that is already in the table is not refused: it comes in as a flagged copy (`DuplicateOf`), so the
import API makes the caller say skip or keep.

**Rules live in the database, not in code.** Field labels, limits and custom fields are versioned in `RuleVersions` and
served by `GET /schema`. `Application/Rules/RulesService.cs` keeps the current set in memory (state shared by every
request, so it is not in the domain), `Domain/Rules/FieldChecks.cs` does the checking, `Application/Rules/RuleChanges.cs`
takes the locks and checks the version the page was looking at, and `Application/Rules/RulesAdminService.cs` loads,
saves and deletes versions through `Application/Ports/IRulesStore.cs`. Custom field values sit in `Industries."Extra"`. The page reads the rules and the API
checks them again, so a page is never the only guard.

**One name rule everywhere.** Two names are the same when they match ignoring case, accents, spaces, punctuation and
symbols, by ICU. It exists three times, kept in step by hand: the Postgres collation `name_rule`,
`backend/Domain/Rules/Names.cs`, and `angular/src/app/domain/name-key.ts`. `testing/check_names.py` holds the shared examples,
and `backend/Tests/Domain/NamesTests.cs` holds C# to the same pairs.

**Auth** is a Bearer token kept in `localStorage` (`stock-listing-token`), attached by
`angular/src/app/infrastructure/auth.interceptor.ts` and stored by `infrastructure/token-store.ts` (behind the
`TokenStore` port). Anyone can browse.
Endpoint groups choose `RequireViewer`, `RequireManager` or `RequireAdmin` (`Presentation/Authorization/Policies.cs`)
and `RequireDatabaseReady` (`Presentation/Endpoints/SchemaEndpoints.cs`). The signed-in user comes from
`Application/Ports/ICurrentUser.cs`, loaded by `Infrastructure/Persistence/SessionUser.cs`. Route guards are in
`angular/src/app/application/guards.ts` and must agree with the endpoint groups.

**Errors.** Every exception goes through `backend/Presentation/Errors/ApiExceptionHandler.cs`: `Describe` maps it to a status
and a plain sentence, expected ones (bad input, name taken, concurrent change, busy) log one line, only the unexpected
log a stack. `RouteHandlerOptions.ThrowOnBadRequest` is on, so bad JSON reaches it as `BadHttpRequestException`.

**The Scratchpad** keeps each board as one JSON document validated by `backend/Domain/Scratchpad/BoardRules.cs`. The client
engine is `angular/src/app/domain/board/` (pure `ops`, `geometry`, `tools`) with the stores and board engine in
`application/board/`. The carry tray from the Overview is server side (`/scratchpad/tray`), uploaded files live on disk
under `scratchpad-files/` with a sweeper that removes unused ones (`Application/Jobs/ScratchFileSweep.cs`, run hourly by
`Infrastructure/Hosted/ScratchFileSweeper.cs`). What a file may be is `Domain/Scratchpad/ScratchFileRules.cs`.

**Backups are sealed to this computer.** `backend/Infrastructure/Backups/`: the dumps and the CSV are encrypted
(`BackupCipher`) and every backup carries a `signature.json` (`BackupSigner`, an HMAC over the files' hashes). Both
halves of the key sit in `backup-key/`, wrapped by Windows DPAPI (`DpapiKeyProtector`, behind `IKeyProtector` in
`Infrastructure/Security/KeyProtector.cs`), so a backup or a key copied to another PC is refused
rather than loaded. The signature is checked before anything reaches `pg_restore`, because a dump runs whatever SQL it
holds. A missing or foreign key is an error, never a reason to make a new one. So the API runs on Windows only: on
anything else `KeyProtection.ForThisComputer` stops startup. The smoke run swaps `IKeyProtector` alone, which is how it
runs on Linux.

**The page layout.** `angular/src/app/app.html` is the shell: the top `.nav` for everyone, the slim `.admin-nav` on admin
pages, and on a phone the links move into the sliding `.menu-panel`. Each route's `data` (in `app.routes.ts`) sets the
header (`title`, `lede`, `centered`), `admin` and `wide`. `app.ts` puts an `admin-layout` class on `<html>` for admin
pages, and `styles.css` gives that class its own dark and light palette on top of the `:root` tokens. The tokens are
custom properties at the top of `styles.css`, and components use `var(--…)` rather than colours of their own. There is
no shared breakpoint convention. CSS can't read a variable in `@media`, so each file writes its own `max-width`: 640px
in nine files (`app.css` and most of the components), 760px in five (`app.css`, `fields`, `history`, `my-components`,
`tables`), and 390, 460, 480, 560, 620, 860 and 960 once or twice each. Responsive rules stay where the component is.

**Ticket text marks.** Requests text can carry `**bold**`, `_italic_` and backtick code. The stored text stays plain.
`angular/src/app/presentation/components/requests/format.ts` parses and writes the marks, `format-field.*` is the
writing box that shows them while typing, and `rich-text.ts` (`app-rich-text`) shows saved text as text nodes. The API
only checks the length (2000 characters, in `Application/Requests/RequestService.cs`) and does not know the marks. Not
to be confused with `presentation/components/scratchpad/rich-text.ts`, the Scratchpad's note editor.

## Pairs of files that must change together

| One side | The other side |
|---|---|
| `angular/src/app/domain/models/board.ts` | `backend/Domain/Scratchpad/BoardRules.cs` (the board shape) |
| `HistoryPage.noteMax` in `history.ts` | `HistoryEndpoints.NoteMax`, which aliases `HistoryService.NoteMax` (the restore note limit, 300) |
| `angular/src/app/domain/name-key.ts` | `backend/Domain/Rules/Names.cs` and the `name_rule` collation |
| A model in `backend/Domain/Entities/` | an EF migration in the right chain, and the TS type in `domain/models/industry.ts` |
| A method on an API class in `angular/src/app/infrastructure/` | the same method on its port in `application/ports/` |
| A route in `app.routes.ts` | its guard, and the `Require*` on the endpoint group |

## Things that bite

- **No request body carries validation attributes.** `AddValidation()` stays in `Program.cs`, but every check is a
  hand written rule in the domain or a use case, so a new free text field needs its own length check there. JSON
  bodies are capped at 2 MB (`Http:MaxRequestBodyKb`), uploads raise their own limit on the request.
- `GET /industries` returns the whole table, and Browse and Overview compute everything from it in the browser. Fine at
  tens of thousands of rows, see Phase 2 below. The Scratchpad uses `/industries/search`, `/top` and `/by-ids` instead.
- A restore brings back rows and rules, not old columns. That is by design, old columns are a developer request.
- The checks in `testing/` delete rows. `testing/t.py` refuses the API on 5005 or 7165 and any database called `main`,
  `collector` or `api_v2`, so run them against a throwaway API on 5104 only. The `testing/` scripts were restored from history after the refactor and have not been run since; run them against a throwaway API on 5104.
- The CSV escaping lives once, in `backend/Domain/Export/CsvText.cs`, used by the History download, the Tables export and the backup Excel file; new CSV output goes through it.
- Comments in this repo are plain sentences about intent and the reason, not labels. Match that.
- Migrations keep the namespaces `api_v2.Migrations` and `api_v2.Migrations.State` though they sit in
  `backend/Infrastructure/Persistence/`, and the entities keep `api_v2.Domain.Entities`: the snapshots name them, so a
  rename would make EF see a model change. `migrate.ps1` passes `--namespace` for that.
- Commit only when asked, as one plain line in the owner's lowercase style with a `Contributor:` trailer, no co-author line.

## Current plan

Full text: `docs/plans/2026-10-11-history-hardening.md`.

| Phase | What | State |
|---|---|---|
| 1 | History hardening: restore note capped at 300 (page, API, storage), import must say skip or keep on duplicates, response compression and a 2 MB body cap, expected errors logged as one line | **Built**, commit `419491d`. Page tests and both builds pass, checked by hand against a copy of the data. |
| 1b | Run `testing/check_history_limits.py` on a throwaway API | **Not run yet**, needs the setup in `testing/README.md` |
| 2 | Server side paging: `GET /industries/page`, `/industries/summary`, `/industries/export`, then move Browse and Overview onto them and drop the full list call | **Design only, needs its own approval.** Start when the table nears about 100,000 rows or the compressed list passes about 5 MB. Order: summary, paged list, export. |

Alongside it, `docs/plans/2026-10-15-history-requests-desktop.md` (History and Requests polish, desktop only, page code
only): all seven asks are built. In the Requests list the status only reads, it changes inside the ticket, and
`canSetStatus` in `requests.ts` is the one check a roles panel will replace later. The phone gets a later pass of its own.

The clean architecture pass is built on branch `clean-architecture`: `docs/plans/2026-10-18-clean-architecture.md` split
the code into the four folders, and `docs/plans/2026-10-19-clean-architecture-projects.md` made each layer its own
project, moved what still bent the rules, and added the layer tests, the page's layer check and the smoke run.
