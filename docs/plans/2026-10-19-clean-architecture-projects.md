# Clean architecture, enforced: one project per layer, and a layer check for the page

Follows `2026-10-18-clean-architecture.md`, which sorted the code into Domain, Application, Infrastructure and
Presentation folders inside one project, held by grep gates. This pass makes the rule something the build checks, and
moves what still bent it. Behaviour, the wire format and the database schema stay as they were. All on
`clean-architecture`.

## What still bent the rule before this pass

- Application read `IConfiguration` (`LoginFailures`, `SettingsService`, `ScratchFileSweeper`,
  `AccountsAdminService.EnsureAdminAsync`) and ran `BackgroundService` timers with `IServiceScopeFactory`.
- `Domain/Rules/RulesService` held state (the rules in use, a save lock), and Application called its `internal`
  members and the `internal SectorList`, which can't cross an assembly boundary.
- The error handler in Presentation read EF's and Npgsql's exceptions. Endpoints took locks, built a `ScratchFile`
  entity, wrote and deleted upload files, read config, and returned the `DevRequest` entity as JSON.
- `BackupSigner` called Windows DPAPI directly at startup, so the API could not start anywhere else and nothing could
  be smoke tested off Windows.
- `testing/transfer-check` linked source files from paths that no longer existed and did not build. The migration and
  Scratchpad checks in `testing/` read source files from paths that no longer existed.
- The page: `domain/board/tools.ts` imported the board engine from `application/` (a cycle), four application files
  imported infrastructure, `auth`, `profile` and `settings-store` called `HttpClient` themselves, ten components
  injected the API classes, nine handled `HttpErrorResponse`.

## What it is now

```
api_v2.slnx
api_v2/                     the host: Program.cs (composition root), appsettings, launchSettings, migrate.ps1
backend/Domain/             entities and pure rules                     references nothing
backend/Application/        use cases, ports, settings records, jobs    Domain + logging/DI abstractions
backend/Infrastructure/     EF + both migration chains, stores, files,  Application, EF, Npgsql, ASP.NET
                            crypto, backups, timers, config reading
backend/Presentation/       endpoints, contracts, filters, errors       Application
Tests/                      layer rules, unit tests, the smoke run
```

Each layer registers its own part (`AddApplication`, `AddInfrastructure`, `AddPresentation`, `MapPresentation`).
Namespaces stayed `api_v2.Domain.*` and so on, and the migrations kept `api_v2.Migrations(.State)`, so the snapshots
are untouched and no migration was made.

The moves, in short:

| Was | Now |
|---|---|
| `Domain/Rules/RulesService` (stateful) | `Application/Rules/RulesService`; Domain's `TableShape` calls the pure `FieldChecks` and `RuleJson` |
| Config reads in Application and endpoints | records in `Application/Settings/AppOptions.cs`, filled in `Infrastructure/DependencyInjection.cs`; the per-request ones (`BackupUploadLimit`, `GuestAccess`) are still read on every request |
| `Application/Hosted/*` timers | the work in `Application/Jobs/`, the timers and scopes in `Infrastructure/Hosted/` |
| EF/Npgsql in the error handler | `IStorageErrors` port, `Infrastructure/Persistence/StorageErrors.cs`; same statuses and sentences |
| Locks and checks in the rules and settings file endpoints | `Application/Rules/RuleChanges.cs`, `Application/Settings/SettingsFileService.cs` |
| Upload handling and `new ScratchFile` in endpoints | `Domain/Scratchpad/ScratchFileRules.cs`, `Application/Scratchpad/ScratchFileService.cs` |
| Backup zip, upload temp file, dump lookup in endpoints | `IBackupService.OpenZip`, `BeginUpload`, `OpenFileAsync` |
| Restore preview assembled in an endpoint | `Application/Backups/BackupPreview.cs` |
| `DevRequest` and `RequestMessage` on the wire | `DevRequestView`, `RequestMessageView` with the same fields and order |
| `/health` inline in `Program.cs` | `Presentation/Endpoints/HealthEndpoints.cs`, the names through `IDatabaseNames` |
| DPAPI inside `BackupSigner` | `IKeyProtector`, `DpapiKeyProtector` (same calls, entropy and scope), `KeyProtection.ForThisComputer` |

The page: ports in `angular/src/app/application/ports/` as abstract classes (`IndustryGateway`, `TablesGateway`,
`ScratchGateway`, `AuthGateway`, `ProfileGateway`, `SettingsGateway`, `TokenStore`), wired by
`infrastructure/providers.ts` in `app.config.ts` and in every spec that builds a test module. `ApiFailure` is the shape
of a failed call; Angular's error objects already have it, so nothing is converted, but nothing outside
infrastructure imports `@angular/common/http`. Upload progress is the port's own `UploadEvent`. `BoardSync` moved to
`application/board/`, the settings types to `domain/models/settings.ts`, and the tools work against
`domain/board/editor.ts`, which `BoardEngine` implements.

Two departures from the approved plan, both for the same end:

- The plan said infrastructure would turn `HttpErrorResponse` into an `ApiError`. A structural `ApiFailure` that the
  HTTP errors already satisfy does the same for the dependency rule without changing any value at runtime, so no
  error path can behave differently.
- The plan said specs would get `provideInfrastructure()` from a global providers file. The unit test builder's
  `providersFile` broke every suite ("BrowserXhr needs JIT"), so each spec that builds a test module lists it instead.

## How the rule is checked

- The compiler: a layer can't name a project it doesn't reference.
- `Tests/Architecture/LayerRules.cs`: what each assembly references (Domain only the BCL; Application only
  Domain and the logging and DI abstractions; Presentation never Infrastructure, EF or Npgsql; Infrastructure never
  Presentation), each layer's namespace, and no disk, network or process calls in Domain or Application source.
- `SmokeFlow.No_endpoint_takes_an_entity`: no endpoint parameter is a `Domain.Entities` type.
- The page: `npm run lint:layers` (dependency-cruiser 18.5.0, `angular/.dependency-cruiser.cjs`): domain imports no
  other layer and no Angular; application no infrastructure, presentation, environment or HTTP library; presentation no
  infrastructure, environment or HTTP library; infrastructure no presentation; no cycles. Specs are exempt.

Each rule was broken on purpose and seen to fail, then put back: Npgsql in Presentation, Infrastructure in Application
and EF in Domain (compile errors); a file read in Domain, a configuration package in Application, an endpoint taking
`Industry` (test failures); infrastructure in a component, the board engine in the domain, `HttpClient` in
application, `HttpErrorResponse` in a component and `@angular/core` in the domain (layer check failures).

## Results

Run on Linux in the cloud session (Ubuntu 24.04, .NET SDK 10.0.112, Node 24.22, Postgres 16.15 because Docker Hub
refused the `postgres:17` pull with 429 Too Many Requests).

- `dotnet build api_v2.slnx`: no warnings, no errors.
- `dotnet test api_v2.slnx`: 42 passed. The smoke run walks a fresh database through startup and both migration
  chains, sign in, the password change, signed in `/health`, rules, industries (add, read, search, edit, the name rule
  refusing a near duplicate, delete), a table with a row through CSV and the bin, a board with a stale save refused, a
  file up, read back inline and deleted, a refused file kind, a request with a reply and a status, an account with a
  note, the backups list and three backup answers, History versions and settings, the settings file export, preview
  and import, a stale rules version refused, the person's settings and profile, bad JSON as a 400, sign out, and no
  error logged after startup. It ran green on the tree before the refactor (with only the key seam added) and after
  every step. It keeps its databases and folder between runs (`SMOKE_FRESH=1` starts over), and was run fresh and
  then twice more on the kept databases, all green.
- OpenAPI document: identical to the one from before the refactor, after step 1 and after step 2.
- Both migration lists identical to before, `has-pending-model-changes` clean for both chains. A probe migration made
  through the new `migrate.ps1` arguments came out empty, in the right folder and namespace, and was removed.
- `testing/check_migration.py` through the new `dotnet ef --project backend/Infrastructure --startup-project api_v2`:
  forward, back and forward again all ran, migration list and layout exactly restored. Two row checks fail ("every row
  that was there before is untouched" and its twin going back), and they fail the same way on `db07138`, the commit
  before this pass, so they come from the check's fixture on a freshly seeded database, not from this work.
- Page: `npx ng build` clean (initial bundle 506.9 kB against the 500 kB budget; it was 504.3 kB before, over budget
  already), `npx ng test --watch=false` 287 passed in 29 files, the same as before, `npm run lint:layers` clean.

## Not verified

- Anything on Windows. `start.bat`, `migrate.ps1`, the DPAPI path itself and `testing/transfer-check` past its missing
  key line were checked by reading only. `start.bat` still runs `dotnet run` in `api_v2/`, which builds `backend/` too.
- The other checks in `testing/` (they need a throwaway API on 5104, which can't start off Windows) and the browser
  checks. `check_scratchpad.py` now reads its source files from the new paths; the markers it slices on were found
  there, but the script wasn't run.
- Making a backup (needs `pg_dump` on Windows paths and the real key) and restoring one.
