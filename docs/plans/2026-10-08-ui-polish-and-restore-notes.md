# UI polish and restore notes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Five small, visible fixes to the admin pages — a lighter dimmed and blurred background behind the shortcuts panel, Fields and History back on the normal nav, a required note in place of typing RESTORE, an orange glow on the restore panel, and a "how old is this" line beside each saved version — plus the `HANDOFF.md` section that lets the next session build the Scratchpad.

**Architecture:** Frontend-only except one API change. Four of the five are CSS plus a component each; the RESTORE change touches both sides (the endpoint's gate and the History panel) and reuses the collector's existing `reason` column rather than adding one, because the `versions` table is created by raw SQL with no EF migration.

**Tech Stack:** Angular 22 (standalone components, signals; vitest + jsdom), .NET 10 minimal API, PostgreSQL 18 (`main` live, `collector` history), Playwright installed in `testing/` for the browser checks.

**Spec:** This document is the plan of record. `ce-plan` ran as a bootstrap (the repo has no `docs/brainstorms` or upstream requirements document). The Scratchpad is deliberately out of scope and gets its own spec, plan and session; Unit 6 prepares that handoff.

## Global Constraints

- **Plain words on the page.** The people using this are not developers. No "payload", no "endpoint", no "validation".
- **Colours only from the variables in `angular/src/styles.css`.** Never a raw hex in a component. `--signal` is the one signal colour: `#c63f12` light, `#ff7a4d` dark, `#f2673a` on admin pages in dark mode.
- **CRLF** in every file under `angular/src`. Keep it.
- **Tests first.** Write the failing test, run it, watch it fail for the right reason, then implement. jsdom cannot see paint, so anything purely visual also needs the browser check in Unit 7.
- **Checks:** frontend `node node_modules\@angular\cli\bin\ng.js test --watch=false` then `... build`, run from `angular/`; API `dotnet build -c Release` from `api_v2/` (Release, because a running API locks the Debug output).
- **Commits:** the repo's convention is one plain lowercase line plus a `Contributor:` footer, **and commits only when the user asks**. Treat every commit step below as a checkpoint to offer, never an automatic commit.
- **Do not touch** `api_v2/appsettings.Development.json` — it is gitignored and holds the working local database password.

---

## Prerequisite P0 — the working tree (decide before Task 1)

The tree holds a day of uncommitted work: 30 modified files, the `AddUserNotes` migration, `Components/settings/`, the shortcuts-panel spec, and Playwright in `testing/`.

- **Option A (assumed by this plan):** commit that work as a baseline first, so this plan's commits are readable on their own.
- **Option B:** work on top and commit everything together. If you choose B, ignore every commit step.

Decide before starting; do not leave it implicit.

---

## Unit 1 — A lighter, blurred background behind the shortcuts panel

**Files:**
- Modify: `angular/src/styles.css` (the `html.shortcuts-open .app` rule, ~line 233)
- Modify: `angular/src/app/Components/shortcuts-panel/shortcuts-panel.css` (`.backdrop`, ~line 2)
- Test: `angular/src/app/Components/shortcuts-panel/shortcuts-panel.spec.ts`

**What changes:** the page behind the panel dims less (`opacity: 0.6` → `0.85`) and the panel's own backdrop gains `backdrop-filter: blur(6px)` plus the `-webkit-` mirror — the same pattern already used on the nav pill at `app.css:27-28`.

**Why the blur goes on the backdrop, not on the page:** `.backdrop` is a **sibling** of `.app` (`app.html:81` vs `:83-86`), so the blur samples the page while the panel itself stays sharp, and it introduces no new containing block. A `filter` on `.app` would change nothing while the panel is open (it already has `opacity` and a `transform`, so it is already a containing block) and would additionally stop the nav pill's own backdrop-filter from sampling the body gradient.

**Do not** add a tint to the backdrop unless it is added to all four theme blocks; the dim keeps coming from `.app` opacity, which is already theme-correct.

**Test scenarios:**
- The `<html>` class is added when the panel opens and removed when it closes — mirroring `app.spec.ts:78`. This pins the hook the CSS depends on, which nothing asserts today.
- A blur is not assertable in jsdom; no test pretends otherwise.

**Verify:** `ng test`, then the Unit 7 screenshot.

---

## Unit 2 — Fields and History back on the normal nav

**Files:**
- Modify: `angular/src/app/app.routes.ts` (`/history` and `/fields` routes)
- Test: `angular/src/app/app.spec.ts` (the `adminPaths` list; the nav assertions)

**What changes:** drop `admin: true` from `/history` and `/fields`. Both keep `adminGuard`, and both render with the normal nav — which already lists History and Fields and highlights the current page. `/overview` and `/settings` remain the two slim-nav tabs.

**Consequence:** the hero header (title and lede from route data) returns to those two pages, above the panel heading each already draws. That is how they looked before the admin shell was applied to them, so this is a revert rather than a new look.

**Test scenarios:**
- The route-table test's expected admin paths become `['overview', 'settings']`; today's assertion is `['overview', 'history', 'fields', 'settings']`.
- The crowded nav still contains `/history` and `/fields` links — it does today, so pin it, making their later removal a deliberate change.
- An admin visiting `/fields` sees the normal nav, not the slim one.

**The trap to watch for:** the suite will not go fully red. `app.spec.ts:58` supplies its own inline stub route that hardcodes `admin: true` for `'/history'`, so the four shell tests around it keep passing while the real route table has lost the flag. Only the route-table assertion at `app.spec.ts:48` catches this — do not treat a green suite as proof.

**Also note:** `angular/src/index.html:13` carries an older hardcoded `/overview` check for the same class. It stays correct after this change (Overview keeps the flag), so leave it alone — but it duplicates `app.ts:17`'s heuristic and is worth folding together one day.

**Verify:** `ng test`; then load `/fields` and `/history` in the browser and confirm the normal nav with the current page highlighted.

---

## Unit 3 — A required note instead of typing RESTORE

**Files:**
- Modify: `api_v2/Endpoints/HistoryEndpoints.cs` (`RestoreBody`; the gate ~line 105; the pre-restore copy ~line 123)
- Modify: `angular/src/app/services/industry-api.ts` (`restore`, ~line 77)
- Modify: `angular/src/app/Components/history/history.ts` (`restoreText` → `restoreNote`; `restore()` ~line 266; `describe()` ~line 171)
- Modify: `angular/src/app/Components/history/history.html` (the gate markup, ~lines 165-178)
- Test: `angular/src/app/Components/history/history.spec.ts`

**What changes:** a saved-version restore is confirmed by a **note of at least 10 characters** naming the restore, not by the word RESTORE.

- **API:** `RestoreBody(string? Note)`; the check becomes trim-and-length; the note is carried into the pre-restore copy's `reason` as `Before restoring version {id} — {note}`.
- **`describe()`** at `history.ts:171-179` prefix-matches `Before restoring version {id}` and appends nothing, so it needs a branch that keeps the text after the dash — otherwise History shows the raw stored string.
- **Client:** posts `{ note }`; the Restore button stays disabled until the note is long enough.

**Decision and why:** the note lives in the existing `reason` column. A separate column would need an idempotent `ALTER TABLE versions ADD COLUMN IF NOT EXISTS` (the table is raw SQL, `CollectorStore.cs:73-85`, with no EF migration) plus a change to the shared `SummaryColumns` ordinal list read by two callers — more risk for no gain.

**Scope boundary:** the **backup card keeps its typed RESTORE gate** (`BackupEndpoints.cs:66`, `BackupRestore.cs:92`). Only the saved-version panel changes, which leaves `testing/check_restore.py:64`'s exact-reason assertion untouched.

**Test scenarios:**
- The panel no longer says "Type RESTORE to confirm".
- The Restore button is disabled with an empty note, disabled at 9 characters, enabled at 10.
- Clicking sends `{ note: '<the note>' }` to `/history/versions/{id}/restore`.
- Nothing is sent while the note is too short.
- API: a missing note, or a 9-character note, returns 400 with a plain message; a 10-character note proceeds. This is the test that proves the gate is real rather than cosmetic.

**Risks:**
- The API enforced the old gate in two places. Leaving the backup one alone is intended, but the saved-version client must stop sending `{ confirm }` in the same change or every restore 400s.
- A 10-character minimum is weaker friction than a fixed word — that is the trade chosen; "aaaaaaaaaa" still passes.

---

## Unit 4 — The restore panel glows orange, then fades

**Files:**
- Modify: `angular/src/app/Components/history/history.css` (new `@keyframes`, a glow class, and a reduced-motion block — nothing in this file uses `--signal` yet)
- Modify: `angular/src/app/Components/history/history.html` (apply the class to the panel, `#version-panel`)
- Test: `angular/src/app/Components/history/history.spec.ts`

**What changes:** when the restore panel opens, its frame glows `var(--signal)` and fades back to normal. Because the whole panel lives inside `@if (panel())`, the animation re-runs each time it opens with no extra state.

**Test scenarios:**
- The glow class is present on `#version-panel` while the restore panel is open, and absent once it closes.
- jsdom cannot assert animation or computed styles, so the reduced-motion half is proven in the Unit 7 browser check with the media query emulated.

**Reduced motion:** the repo honours it per component (`shortcuts-panel.css:392`, `overview.css:1391`, `app.css:363`, `login.css:66`). `history.css` has no such block today, so add one with `animation: none`.

**Verify:** Unit 7 screenshots in **both** colour modes — `--signal` is `#c63f12` in light and `#f2673a` on admin pages in dark.

---

## Unit 5 — "How old is this" beside each saved version

**Files:**
- Create: `angular/src/app/Components/history/age.ts`
- Create: `angular/src/app/Components/history/age.spec.ts`
- Modify: `angular/src/app/Components/history/history.html` (the saved-versions row)

**What changes:** a pure helper turning an ISO timestamp into plain words: **under a day → "9 hours"**; **a day or more → "1 day 4 hours"**, dropping the hours when they are zero ("2 days"). Under an hour was not specified and is **assumed** to read "less than an hour". The saved-versions list shows it beside the exact date, which stays.

**Pattern to follow:** `angular/src/app/Components/overview/overview-data.ts` with its spec — a pure, dependency-free module with a dedicated `*.spec.ts`, no Angular test harness. Follow `idle-top.ts` for style: a `static readonly` threshold, a top comment saying why in plain words, and time passed in as a default parameter (`now = Date.now()`) so a test needs no fake timers.

**Where it shows:** `history.html:52` is the saved-version line today (`{{ formatDate(v.createdAt) }} · …`). The exact date stays; the age goes beside it.

**The value it reads:** `VersionSummary.createdAt` is a `string` (`models/industry.ts:98`), serialised from a `DateTimeOffset` with **no custom converter**, so the shape is `2026-10-08T00:50:00+00:00` — offset `+00:00`, never `Z`, up to six fraction digits. `Date.parse` handles it, and both sides are UTC, so no timezone work is needed.

**Duplication worth knowing, not fixing here:** `overview.ts:158-161` already builds a "less than a minute ago / N minutes ago" string inline — the only relative-age wording in the app, and untested. This helper is the natural home for it eventually; absorbing it is a separate change on a different page.

**Test scenarios:**
- 0 minutes → "less than an hour"; 1 hour; 23 hours (still hours).
- Exactly 24 hours → "1 day"; 28 hours → "1 day 4 hours"; 48 hours → "2 days".
- A future timestamp (clock skew) reads "less than an hour" rather than a negative.
- An empty or malformed string returns nothing rather than "NaN".

**Note:** the helper takes "now" as a parameter, so the tests need no fake timers.

---

## Unit 6 — HANDOFF.md carries the Scratchpad

**Files:**
- Modify: `HANDOFF.md` (repo root; tracked, though listed in `.gitignore`)

**What changes:** a new section for the next session, in the file's existing plain style, containing:

- **What the Scratchpad is and where its design lives:** `design/Scratchpad-Light.dc.html`, `design/README.md`, and the Scratchpad part of `OVERVIEW_HANDOFF.md`.
- **The decisions the design says still need the user's yes:** server storage is approved in principle; **the 25 MB file limit is a placeholder the user has not chosen**; the table and field names must be confirmed with the user; a migration is required.
- **The prototype's must-haves:** **undo/redo is essential and must not ship without it**; files must upload to the server rather than living in the tab.
- **What the design refuses:** Word, PowerPoint and Excel files, with the SVG-preview question left open for the user.
- **What exists today:** no Scratchpad code, route or tab anywhere in the repo.
- **The state it inherits:** Overview and Settings are the admin tabs; History and Fields are back on the normal nav (Unit 2); People, Rename, admin notes and Delete live inside Settings; the database runs on the user's own PostgreSQL 18 with `main` and `collector`.
- **The build order the user asked for:** the items they lettered a, b, d, then c, f, g, and **e (files) only after they confirm file storage** (`OVERVIEW_HANDOFF.md:122`).
- **Closed by the user — do not build:** the "Apply anyway" button that would leave one key on two functions (`OVERVIEW_HANDOFF.md:95`).
- **Shape hints the design already fixed:** a snapshot is `{ kind, title, takenAt, numbers }`; a group is only `{ id, name, itemIds }`; a line is `{ from, to, label, head, bend }`; text is spans of `{ text, bold, highlight }`; one endless board per person that remembers position and zoom; and the 25 MB placeholder is a single constant in the prototype (`maxMb()`).
- **Two hooks already waiting for it in code:** `shortcuts.ts:13-14` says the Scratchpad joins `ADMIN_PAGES` and the `Scope` union when it is built, and the prototype's key list already carries a `scratchpad` scope and `nav.scratchpad`; and `app.spec.ts:75-76` pins the admin tabs to exactly `['Overview', 'Settings']`, so adding the tab changes that assertion.
- **Two things wrong in the file today**, worth fixing while it is open: line 3 sends the reader to `plan.md`, which does not exist; and the "Waiting on the user" item about the Overview says it is waiting on a design, though the Overview is built and committed.

**Verification:** read it back as a stranger would. The unit is done when the section answers *what, where, what is decided, what is not, and what is essential* — so a new session can start without asking.

---

## Unit 7 — The browser check the rest of this leans on

**Files:**
- Create: `testing/check_ui.mjs`

**What changes:** the throwaway script used while planning becomes a repo check. It signs in using `scripts/seeding.control.toml`, then asserts and screenshots the five changes: the dimmed/blurred backdrop, Fields and History on the normal nav, the note gate (disabled at 9 characters, enabled at 10), the glow class on the restore panel, and the age line beside a saved version. Screenshots go to a folder given on the command line.

**Why:** jsdom cannot see any of it, and the next session (the Scratchpad) needs the same harness. Playwright is already installed in `testing/`, whose README already documents `.mjs` page checks.

**Constraints:** never confirm a restore; never write to the database; refuse to run against anything other than `localhost:4200`.

---

## Unit 8 — The verification loop

- **Per task:** the failing test first, then the passing test, then `ng test`, `ng build`, and `dotnet build -c Release` wherever the API changed.
- **Per batch:** the Unit 7 browser check, in light and dark.
- **The user's own verification loop**, given 2026-10-08: a critic subagent scans the repo, writes its own rubric and scores the work out of 10, where **6 passes** and below that loops up to three times; all judgement happens in the real frontend through Playwright, played as a regular user, with UI and UX problems reported and deducted and no claim taken on trust; an implementer may consult up to **two** advisor subagents per round before starting; and after three failed passes the work stops and reports what failed rather than retrying. It is applied here before any of this is called done.

---

## Out of scope (deliberately)

- **The Scratchpad** — its own spec, plan and session. Unit 6 prepares it.
- **Restoring from a dump file you upload** — deferred by the user, "discussed after everything".
- The README rewrite, the API's can't-log-without-a-console crash, and committing the day's work (that last one is Prerequisite P0).
- The backup card's typed RESTORE gate, and the app's other typed confirmations.

## Noticed while planning (not in scope)

- **Escape does not close the History restore panel.** Verified in the browser: pressing Escape leaves `#version-panel` open. Every other dialog in the app closes on Escape.
- The restore panel has **no focus trap**, unlike the shortcuts panel, so Tab can walk out of it into the page behind.
- **`/fields` now shows its title twice.** With the page header back (Unit 2), the big "Fields" sits directly above the card heading "Fields" with its version badge. `/history` does not have this — its card is headed "Saved versions". Found by a task reviewer and confirmed in a real browser; left alone because it is page copy and it is how the page looked before the admin shell was applied to it this morning. If the duplication is unwanted, it is a one-line change in `fields.html`.
