# Clean architecture refactor

Status: in progress on branch `clean-architecture` (from `main` at `2b929a6`). Owner: Lead (deepseek-flash), with GPT-6 Luna (`openai/gpt-6-luna`, through workflow agents) for mechanical file-local edits.

Done so far, one commit each:

| Phase | State |
|---|---|
| P0 baseline | green build, 287 page tests, both migration chains clean, OpenAPI baseline captured (64 paths, 33 schemas), plan doc written |
| P1 folders | every file moved to its layer folder with a matching namespace; EF entity type strings patched in the 14 Designer files and both snapshots; model checks clean; full rebuild green |
| P2 contracts | 10 endpoint files lost their inline request records to `Presentation/Contracts` (Luna, two batches); Dtos already in Contracts |
| P3 | Industries fully behind `IndustryService`, `IIndustryStore`, `INameIndex`, `ICollectorStore`, `IAppLocks`; sign in, sign out, who-am-i and password behind `AuthService`, `IAccounts`, `IPasswordHasher`; settings and profile card behind `MeService`, `ProfileService` and their stores, with `ShortcutRules` and `ProfileRules` in the domain; requests behind `RequestService` and `IRequestsStore` (the open-request dedupe moved with it); the industry, auth, me, profile and request endpoints no longer touch `AppDbContext`; OpenAPI surface identical every time |
| P4 | Domain has no EF/ASP.NET/Npgsql/file references. Application is clean too: use cases live in `Application/{Industries,Auth,Accounts,Me,Profile,Requests,Rules,Settings}`, and every adapter moved out — `BackupService`, `BackupRestore`, `BackupScheduler`, `MigrationService`, `TableWriter`, `UserTableMirror` now live under `Infrastructure` with ports (`IRulesStore`, `ISettingsStore`, `IScratchFilesStore`, `IUserTablesStore`, `IUserTableMirror`, `IAccounts`, `IPasswordHasher`) and the background jobs hold only ports. Stale usings pruned (219 lines across 40 files) |

All phases are done. Every endpoint binds input, calls a use case or store port and maps the result; no file under `Presentation/` touches `AppDbContext`, EF, Npgsql or raw SQL. `AppBusyException` lives in `Application/Exceptions`, the last infrastructure alias is gone, and the P6 table below is the final verification.

## P5 — the page

Done in one pass, scripted rather than agent-run because relative import depths had to be recomputed: `models/` and the pure `board/` files moved to `domain/`, the board stores and engine to `application/board/`, the HTTP clients and save loop to `infrastructure/`, `services/` split into `application/`/`infrastructure/`/`domain/` per file, `guards.ts` to `application/`, and `Components/` to `presentation/components/`. All relative imports were resolved from each file's old location and rewritten against its new one, Prettier ran over the moved code, then `ng build` reported 0 errors and `ng test --watch=false` passed 29 files / 287 tests — the same count as the baseline. Commit `69663ec`.


## Goal

Move `api_v2` into four layers — Domain, Application, Infrastructure, Presentation — and the Angular app into `domain/`, `application/`, `infrastructure/`, `presentation/`, without changing behavior, the HTTP surface or the database schema.

Success means: `dotnet build` green, `npx ng build` green, `npx ng test --watch=false` green with the same test count, `dotnet ef migrations has-pending-model-changes` clean for both contexts, zero new migrations, dependency gates pass, OpenAPI surface identical to baseline.

## Layer rules

Dependencies point inward only.

- `Domain/**`: entities and pure rules. No EF, no ASP.NET, no Npgsql, no file or network I/O.
- `Application/**`: use cases and the ports they call out through. No `AppDbContext`, no EF, no reference to `Infrastructure` or `Presentation`.
- `Infrastructure/**`: EF contexts, collector SQL, advisory locks, crypto, file folders, configuration readers, dumps. Implements ports. Never references `Presentation`.
- `Presentation/**`: minimal API endpoints, request/response contracts, authorization filters, exception mapping. No `AppDbContext`, no SQL, no file access.
- `Program.cs` stays at the project root and is the only composition root.

Single project for now: the gates are grep plus review. Project-per-layer is a later, optional step, and would then need the EF snapshot strings patched and re-verified.

## Target tree

```
api_v2/
  Domain/
    Entities/          Model/* entities
    Rules/             Names (pure part), FieldRule, RuleSet, DefaultRules, field checks
    Tables/            TableShape, TableLimits, ColumnInput
    Scratchpad/        BoardRules
    History/           planned rows, rename map, old-row fitting
    Accounts/          Roles
    Collector/         Retention + Check
  Application/
    Ports/             ICollectorStore, IAppLocks, ICurrentUser, IIndustryStore, IAccounts,
                       IRulesStore, INames, ISettingsStore, IBackupStore, IBackupSigner,
                       IBackupCipher, IScratchFiles, IUserTableFiles, IMigrationsRunner, IClock
    Auth/              LoginFailures, login/session use cases
    Accounts/          UserService use cases
    Industries/        list, search, top, byIds, add, edit, delete
    History/           PlanImport, ImportRows, RestoreTable
    Backups/           Create, List, Delete, Prune, Restore, Seal
    Rules/             LoadRules, SaveRules, AddField(s), DeleteField, SyncSectors
    Tables/            SaveTable, DeleteTable, UserTableMirror use case
    Scratchpad/        board and file use cases
    Requests/          RequestService, Drafts
    Settings/          retention load/save
    Health/            DatabaseStatus, DatabaseReady
    Startup/           MigrationService orchestration
    Hosted/            BackupScheduler, HistoryMonitor, ScratchFileSweeper, TableBinSweeper
  Infrastructure/
    Persistence/       AppDbContext, DataModel, StateModel, MigrationContexts, CollectorStore,
                       AppLocks, SessionUser, NameIndex, RulesStore, TableWriter, Migrations/
    Security/          PasswordHasher, BackupCipher, BackupSigner
    Files/             ScratchFileStore, UserTableFiles
    Configuration/     DatabaseConnections, SectorList
    Export/            CsvText
    Backups/           BackupStore, BackupTool, BackupArchive
  Presentation/
    Endpoints/         13 endpoint files plus HealthEndpoints
    Contracts/         every request/response record
    Authorization/     RequireSignIn / RequireManager / RequireAdmin / RequireViewer
    Errors/            ApiExceptionHandler
  Program.cs, appsettings*.json, api_v2.csproj, Properties/
```

## File mapping

### Model/ → Domain/Entities (all fifteen, namespace `api_v2.Domain.Entities`)

Industry, RuleVersion, DevRequest, RequestMessage, AppSetting, User, Session, UserNote, ScratchBoard, ScratchFile, ScratchTray, UserSettings, UserAvatar, UserTable, UserTableRow.

The entities are plain classes; all EF configuration is fluent in `DataModel.cs` / `StateModel.cs`. The only place the CLR type name is written down is the model snapshots: 14 `*.Designer.cs` files and both `*ModelSnapshot.cs` carry strings such as `"api_v2.Model.Industry"`. Patch those strings in the same change and run the pending-model-changes check. Never run `dotnet ef migrations add` after the move.

### Data/

| File | Layer | Target |
|---|---|---|
| AppDbContext.cs, DataModel.cs, StateModel.cs, MigrationContexts.cs | Infrastructure | `Infrastructure/Persistence/` |
| CollectorStore.cs | Infrastructure | `Infrastructure/Persistence/`, implements `ICollectorStore` |
| AppLocks.cs | Infrastructure | `Infrastructure/Persistence/`, implements `IAppLocks`; `AppBusyException` → `Application/Exceptions/` |
| ScratchFileStore.cs | Infrastructure | `Infrastructure/Files/`, implements `IScratchFiles` |
| DatabaseConnections.cs | Infrastructure | `Infrastructure/Configuration/` |
| DatabaseStatus.cs, DatabaseReady.cs | Application | `Application/Health/` |
| HistoryMonitor.cs | Application | `Application/Hosted/` |
| MigrationService.cs | Application | `Application/Startup/`; migration running behind `IMigrationsRunner` |
| SettingsService.cs | split | `Retention` + `Check` → `Domain/Collector/`; load/save → `Application/Settings/` + `ISettingsStore`; EF side → `Infrastructure/Persistence/SettingsStore` |
| CsvText.cs | Infrastructure | `Infrastructure/Export/` |

### Rules/

| File | Layer | Target |
|---|---|---|
| Names.cs | split | pure rule → `Domain/Rules/Names.cs`; `TakenAsync` → `INameIndex` + `Infrastructure/Persistence/NameIndex` |
| FieldRule.cs | split | `FieldRule`, `RuleSet`, `DefaultRules` → `Domain/Rules/`; `NewField`, `NewFields`, `SaveRules`, `FieldDeleted` → `Presentation/Contracts/Rules` |
| RulesService.cs | split | pure checks, parse/convert/keys → `Domain/Rules/FieldChecks.cs`, `FieldJson.cs`; load/save/field use cases → `Application/Rules/`; EF → `Infrastructure/Persistence/RulesStore` |
| SectorList.cs | Infrastructure | `Infrastructure/Configuration/` |

### Backups/

| File | Layer | Target |
|---|---|---|
| BackupService.cs | split | use cases → `Application/Backups/` (create, list, delete, prune, seal); folders/ids/tool/zip → `Infrastructure/Backups/BackupStore.cs`, `BackupTool.cs`, `BackupArchive.cs` |
| BackupRestore.cs | Application | `Application/Backups/RestoreBackup`; signature check and `pg_restore` behind infrastructure ports |
| BackupCipher.cs | Infrastructure | `Infrastructure/Security/` |
| BackupSigner.cs | Infrastructure | `Infrastructure/Security/` |
| BackupScheduler.cs | Application | `Application/Hosted/` |

### Auth/

| File | Layer | Target |
|---|---|---|
| CurrentUser.cs | split | `ICurrentUser` → `Application/Ports/`; `Roles` → `Domain/Accounts/`; `SessionUser` → `Infrastructure/Persistence/`; Require* filters → `Presentation/Authorization/Policies` |
| PasswordHasher.cs | Infrastructure | `Infrastructure/Security/` |
| LoginFailures.cs | Application | `Application/Auth/` |
| UserService.cs | split | use cases → `Application/Accounts/`; EF queries → `Infrastructure/Persistence/UserStore` |

### Endpoints/, Dtos/, Errors/

- `Endpoints/*` (13 files) → `Presentation/Endpoints/`, reduced to bind → call use case → return contract.
- Inline request bodies declared inside endpoints → `Presentation/Contracts/<Feature>.cs` so `AddValidation()` sees them.
- `Dtos/CreateIndustry.cs`, `IndustryDto.cs`, `UpdateIndustry.cs` → `Presentation/Contracts/Industries.cs`.
- `Errors/ApiExceptionHandler.cs` → `Presentation/Errors/`.
- The inline `/health` handler in Program.cs → `Presentation/Endpoints/HealthEndpoints.cs`.

### History/, Requests/, Scratchpad/, Tables/

| File | Layer | Target |
|---|---|---|
| History/TableWriter.cs | split | rename map, planned rows, fitting → `Domain/History/`; plan/import/restore use cases → `Application/History/`; SQL/transaction writer → `Infrastructure/Persistence/TableWriter` |
| Requests/RequestService.cs | Application | `Application/Requests/` + EF store adapter |
| Requests/Drafts.cs | Application | `Application/Requests/` |
| Scratchpad/BoardRules.cs | Domain | `Domain/Scratchpad/` |
| Scratchpad/ScratchFileSweeper.cs | Application | `Application/Hosted/` |
| Tables/TableShape.cs | Domain | `Domain/Tables/` (with `TableLimits`, `ColumnInput`) |
| Tables/UserTableMirror.cs | split | use case → `Application/Tables/`; JSON on disk → `Infrastructure/Files/UserTableFiles` |
| Tables/TableBinSweeper.cs | Application | `Application/Hosted/` |

### Migrations/ → Infrastructure/Persistence/Migrations

Both chains move untouched: `Migrations/` (data) and `Migrations/State/`. Schema changes and `EnsureSchemaAsync` stay exactly as they are.

### Angular

| Current | Target |
|---|---|
| models/industry.ts, models/board.ts | `domain/models/` |
| board/ops.ts, geometry.ts, colour.ts, item-kinds.ts, tools.ts | `domain/board/` |
| services/name-key.ts | `domain/names.ts` |
| board/boards-store.ts, tray-store.ts, board-engine.ts | `application/board/` |
| board/board-sync.ts, scratch-api.ts | `infrastructure/board/` |
| board/colour-preview.ts | with the colour picker component |
| services/auth.ts | `application/auth.ts` + `infrastructure/token-store.ts` |
| services/auth.interceptor.ts | `infrastructure/auth.interceptor.ts` |
| services/industry-api.ts, tables-api.ts | `infrastructure/`; `errorText`, `fileNameFrom`, `retryTransient` → `domain/util` |
| services/settings-store.ts, theme.ts, shortcuts.ts, toast.ts, idle-top.ts, profile.ts | `application/` |
| services/count-up.ts, profile-picture.ts | `domain/util` (delete the duplicate `Components/overview/count-up.ts`) |
| guards.ts | `application/guards.ts` |
| Components/ (15 folders) | `presentation/components/`; pure helpers `history/age.ts`, `overview/overview-data.ts`, `requests/format.ts` → `domain/` |
| app.routes.ts, app.config.ts, app.ts/html/css | shell, unchanged |
| `Components/` → `presentation/components/` | two-step move for the case change: `Components` → `Components.tmp` → `components` |

## Luna lane

Luna (`gpt-6-luna`, provider `openai`) runs only through `workflow` agents; `subagent` and `spawn_teammate` cannot pick a model.

- One workflow call per batch, at most 5 agents, disjoint write scopes.
- Each prompt names the exact files, the exact target, the prohibitions (no git, no builds, no `dotnet ef`, no package installs, no edits outside the scope) and asks for `{ filesChanged, notes }`.
- After every batch the Lead runs `git status --short` and `dotnet build`; a batch that breaks the build is reverted before retry.
- Two failures on the same unit and the Lead finishes it personally.

## Phases and gates

| Phase | Work | Owner |
|---|---|---|
| P0 | Branch, baseline builds/tests, both pending-model checks, OpenAPI baseline, this document, commit | Lead |
| P1 | Folder moves and namespace changes, EF snapshot string patch; build + model checks | Lead (scripted) |
| P2 | Inline request records → `Presentation/Contracts`, one unit per endpoint file | Luna |
| P3 | Ports and use cases for Industries and Auth/Accounts as the template, then Requests, Me, Profile, SettingsFile, Schema | Lead template, Luna replication |
| P4 | Splits: RulesService, CurrentUser, BackupService, BackupRestore, TableWriter, MigrationService, UserTableMirror, SettingsService; remaining endpoints thinned | Lead |
| P5 | Angular restructure and import rewrites | Luna |
| P6 | Final gates, OpenAPI diff, optional runtime smoke, empty-folder cleanup | Lead |

## Verification commands

```
cd api_v2 && dotnet build --nologo
cd api_v2 && dotnet ef migrations has-pending-model-changes --context Data
cd api_v2 && dotnet ef migrations has-pending-model-changes --context State
cd angular && npx ng build
cd angular && npx ng test --watch=false
```

Dependency gates at P6:

- `Domain/` must not match `Microsoft.EntityFrameworkCore|Microsoft.AspNetCore|Npgsql|System.IO.File|HttpClient`
- `Application/` must not match `AppDbContext|Microsoft.EntityFrameworkCore|api_v2\.Infrastructure`
- `Presentation/Endpoints/` must not match `AppDbContext|Npgsql|FromSql|System.IO.File`
- `Infrastructure/` must not match `api_v2\.Presentation`

## Risks

- EF sees a model change after the entity namespace move → stop, revert that namespace (keep the folder move), re-run the checks, continue. Do not generate a migration to silence it.
- Restore, import and migration transactions must keep their current boundaries. The use case drives the sequence; the port method owns the EF transaction and the advisory lock.
- Docker is not running, so database-backed smoke tests are conditional on `docker compose up -d`.
- Commits: one per phase, on `clean-architecture` only, no push.

## P6 — finished

Run on the final tree, all green:

| Check | Result |
|---|---|
| `dotnet build --no-incremental` | 0 errors |
| `dotnet ef migrations has-pending-model-changes` (Data + State) | "No changes have been made" both |
| `Domain/` gate (no EF/ASP.NET/Npgsql/IO/net) | 0 hits |
| `Application/` gate (no EF, AppDbContext, Infrastructure) | 0 hits |
| `Presentation/Endpoints/` gate (no AppDbContext/SQL/IO) | 0 hits |
| `Infrastructure/` referencing `Presentation` | 0 hits |
| `npx ng build` | 0 errors |
| `npx ng test --watch=false` | 29 files / 287 tests passed, same count as baseline |
| OpenAPI diff against the P0 baseline | 0 paths, 0 schemas |
| Container validation (`ASPNETCORE_ENVIRONMENT=Development`) | starts, no unresolved services |

Runtime smoke, two rounds against the Docker database (`docker compose up -d`; API in Production, so the Docker default connection on 5433):

1. Dev database (`main`): API applied the pending migrations, /health went ready with History ready, then 33 authenticated checks ran: sign in, password change, /auth/me, /schema, industries list/search/top and add-edit-delete, a table with a row add/edit/delete and CSV export, a Scratchpad board create/read/save/delete, requests, users, backups list, history versions/settings/export, and me/settings. All passed; the one 400 was a malformed board document in the check itself, and the save passed once the board's own document was sent back. The settings file routes were then checked on their own after their port move: export 200, import preview 200, import 200 with nothing changed.
2. Stress databases (`stress_main` 102,445 industries, `stress_collector` 29 versions): API started against them with the connection strings overridden, restore of version 8 (25,151 rows) returned 200 and left new versions 32 ("Before restoring version 8", 102,445 rows) and 33 ("Before restoring version 32 — undo of the restore", 25,151 rows); after the undo the live count was back to 102,445. Import preview of version 8 returned 200 with a 7.4 MB plan. A manual backup returned 200, listed with the other backups, downloaded 200 (52 MB), restore-previewed 200 and deleted 204. Import itself and a full backup restore were not run: both write a lot of data and the paths they share with the checks above are already covered.

The dev smoke used the admin reset hook, so the admin password on the Docker `main` database is now `CleanArch-Smoke-2026`; the stress database admin was set to `Stress-Smoke-2026`. Change either if they matter.

Final shape: `Domain` (entities and pure rules), `Application` (use cases and ports only), `Infrastructure` (EF, SQL, crypto, files, config, backups, migration and restore runners, hosted jobs), `Presentation` (endpoints, contracts, authorization, error mapping), `Program.cs` as the only composition root. The Angular app is `domain/`, `application/`, `infrastructure/`, `presentation/components/` with the shell at the app root.

## Follow-ups after the owner's decisions

All seven follow-ups were handled: the branch is pushed, Docker was closed by the owner, the credentials are noted in `scripts/seeding.control.toml`, the stray stress backup was removed, `appsettings.Development.json` now points at the Docker database with the change explained in `docker_setup.md`, the remaining coupling was cleaned, and the `testing/` scripts were restored from git history (31 files, the commit before they were deleted).

What remains, none of it blocking:

- **Run the checks:** the restored `testing/` scripts (`check_history_limits.py`, the names, restore, tables, scratchpad, backup and migration checks) have not been run since the refactor. They need the throwaway API on 5104 described in `testing/README.md`.
- **Unexercised live paths:** History import writing rows, a full backup restore, and backup upload. Their planning, validation and preview paths were exercised; watch these on first real use.
- **Possible follow-on:** a separate project per layer would turn the dependency rules into compile errors instead of grep gates. Not done here; the single project with folder layers was the agreed scope.
- **Docs still describing older work:** `HANDOFF.md`/`OVERVIEW_HANDOFF.md` were not in this checkout, so the history around them was not updated.