# History hardening, and what comes after

Written 2026-10-11, after a destructive stress test of the History page (run against a copy of the data, never the real
database). Restore, delete, retention, backups and every concurrent mix of them held up. Four things did not, and this
file is the plan for them, with where each one stands.

## What the stress test found

| # | Finding | Root cause |
|---|---|---|
| 1 | An 8 MB restore note was accepted and stored. The History page then took about 11 s to show anything and printed 9.1 million characters. | `RestoreBody` is declared inside `Endpoints/HistoryEndpoints.cs`, outside `Dtos/`, so `AddValidation()` never sees it. It was the only free text input with no cap. `versions.reason` is `text NOT NULL`, and the list endpoint returns it for every row. |
| 2 | `POST /history/versions/{id}/import` with `{}` added every same-name row again (15,681 rows became 47,043). | Same-name rows come in as flagged copies (`DuplicateOf`) by design, so the data stayed valid. But `SkipDuplicates` defaulted to false, so "no answer" meant "add them all". The page always sends a choice, the API did not demand one. |
| 3 | `GET /industries` returns the whole table: 8.1 MB at 47,000 rows, uncompressed. | Browse (24 derived views) and Overview (about 28 aggregations) are built on the full list, and CSV export is client side. |
| 4 | Every malformed request logged two `fail:` "unhandled exception" entries with stacks, though the client got a correct 400. | `ThrowOnBadRequest = true` makes binding failures throw, and the old `UseExceptionHandler` lambda logged every exception at Error. |

Not bugs, so nothing was changed: a double click on Restore (the page blocks it at human speed), `%00` in a path (the
server answers 400, the browser only shows a network error because that answer skips CORS), and list latency under 100
parallel calls.

## Phase 1: the four fixes. Built, commit `419491d`

| Fix | What it does |
|---|---|
| **1. Bound the note everywhere** | Note limit **300** characters, counted in UTF-16 units like the page (`HistoryEndpoints.NoteMax`, `HistoryPage.noteMax`, change both together). The input has `maxlength` and an `n/300` counter. `CollectorStore.SaveVersionAsync` clips any reason to 1000 (`ReasonMax`), the collector has a `versions_reason_length` check made `NOT VALID` so old rows are never blocked, and the list clips an old long reason for display while the version's own answer keeps it whole. Every JSON body is capped at 2 MB (`Http:MaxRequestBodyKb`); a board document is held to 1,000,000 bytes by `BoardRules`, so 2 MB has room. Uploads raise their own limit on their request. |
| **2. Import must be told** | `ImportBody.SkipDuplicates` is `bool?`. When the import has rows whose names are already in the table and the caller did not say, the answer is 409 `{ needsDecision: "duplicates", similar, total, alreadyImportedFromThisVersion, message }`. Nothing is written and no copy is saved. The preview also reports `alreadyImportedFromThisVersion`, and the page warns before a second import of the same version. |
| **3. Guardrails for the big list** | Brotli and gzip response compression (5.7 MB becomes about 1.1 MB). `GET /industries` itself is unchanged, capping it would silently break Browse. Paging is Phase 2. |
| **4. Log by what the error is** | `Errors/ApiExceptionHandler.cs` (an `IExceptionHandler`) holds `Describe`. Expected failures (bad input, a name taken, a concurrent change, a busy lock) log one short information line with no stack. Anything else logs an error with its stack. The framework's duplicate entry never appeared, so no logging config line was needed. |

How it was checked: `ng test` 38 of 38, both builds clean, and every item above run by hand against a copy of the
data, plus the concurrency mix again (parallel restores, a delete storm, retention racing restores, a backup restore
racing a version restore). `testing/check_history_limits.py` holds the same checks for the throwaway API. It compiles
but **has not been run yet**, it needs the setup in `testing/README.md`.

## Phase 2: server side paging. Design only, not started, needs its own approval

The Scratchpad already does this right (`/industries/search`, `/top`, `/by-ids`). Browse and Overview are what pull the
whole list.

**Start when** the table nears about 100,000 rows, or the compressed list passes about 5 MB.

| Piece | Shape |
|---|---|
| Paged list | `GET /industries/page?q&sector&flags&sort&dir&page&pageSize` answering `{ items, total }`. Reuse the `/search` comparison (`lower(btrim(Name))` through `FromSql`) and the paging contract of `UserTableEndpoints.cs` (`PageSizeDefault`, `PageSizeMax`). |
| Summary | `GET /industries/summary?slice&filters` answering bucket counts for the Overview donut, bars and chips, and the "Similar row", "Lost fields", "No price", "No release date" counters. |
| Export | `GET /industries/export` streaming CSV, replacing `exportCsv()` in `my-components.ts`. |
| Pages | Rewrite `my-components.ts` (Browse, 24 computed views) and `overview.ts` (about 28 aggregation sites) onto those. |
| Canary | Seed about 100,000 rows with `scripts/seed_industries.py` and assert list time and compressed size in `check_history_limits.py`. |

Order: summary first (Overview is the heavier page), then the paged list, then export, then delete the full list call.
Each step ships on its own and the page keeps working in between.

## Open items

- Run `testing/check_history_limits.py` on a throwaway API once, and note the result here.
- Brotli is registered first, but gzip came out smaller on this data (1.1 MB against 1.4 MB at the default level).
  Worth a look at the Brotli level if the list size starts to matter.
- A body cap of 2 MB has not met a real board with many long strokes. If a legitimate save is ever refused with 413,
  raise `Http:MaxRequestBodyKb` or lift the limit on that one endpoint, as the upload endpoints do.
