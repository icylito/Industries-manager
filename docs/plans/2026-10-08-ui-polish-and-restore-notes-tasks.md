# UI polish and restore notes — Task Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the five confirmed changes — a lighter dimmed and blurred background behind the shortcuts panel, Fields and History back on the normal nav, a required note instead of typing RESTORE, an orange glow on the restore panel, and a "how old is this" line beside each saved version — and give `HANDOFF.md` the section the next session needs to build the Scratchpad.

**Architecture:** Four tasks are CSS plus a component. One task (3 and 4) changes both sides of the saved-version restore, reusing the collector's existing `reason` column so no database migration is needed. One task adds a pure front-end helper. Two tasks are not application code at all: the browser check that proves the visual work, and the handoff document.

**Tech Stack:** Angular 22 (standalone components, signals; vitest + jsdom), .NET 10 minimal API, PostgreSQL 18 (`main` live, `collector` history), Playwright already installed in `testing/`.

**Spec:** `docs/plans/2026-10-08-ui-polish-and-restore-notes.md` — the unified plan this task plan implements. It carries the decisions and the reasoning; read it alongside this file.

## Global Constraints

- **Plain words on the page.** No "payload", "endpoint", "validation", "payload". The readers are not developers.
- **Colours only from the variables in `angular/src/styles.css`.** `--signal` is `#c63f12` light, `#ff7a4d` dark, `#f2673a` on admin pages in dark mode. Never a raw hex in a component.
- **CRLF** in every file under `angular/src`. The `write` tool emits LF — normalise after writing if you use it, and check with `git diff --check`.
- **Checks, run from the folder named:** `angular/` → `node node_modules\@angular\cli\bin\ng.js test --watch=false` then `... build`. `api_v2/` → `dotnet build -c Release` (Release, because a running API locks the Debug output).
- **Commits:** one plain lowercase line, then `Contributor: deepseek flash`, no co-author line. **Only commit when the user asks** — treat each commit step as a checkpoint to offer.
- **Never touch** `api_v2/appsettings.Development.json`.
- **Never confirm a restore** in any test, check or script.

---

## File Structure

**Modified:**
- `angular/src/styles.css` — the page-level dim, Unit 1.
- `angular/src/app/Components/shortcuts-panel/shortcuts-panel.css` — the blur on the panel's backdrop, Unit 1.
- `angular/src/app/app.routes.ts` — drops the admin shell from two routes, Unit 2.
- `angular/src/app/Components/history/history.css` — the glow, Unit 4.
- `angular/src/app/Components/history/history.html` — the note field, the glow class, the age line.
- `angular/src/app/Components/history/history.ts` — the note signal and gate, the `describe()` branch, the age import.
- `angular/src/app/services/industry-api.ts` — sends the note instead of the word.
- `api_v2/Endpoints/HistoryEndpoints.cs` — requires the note, stores it on the copy.
- `HANDOFF.md` — the Scratchpad brief, Unit 6.
- Three spec files: `shortcuts-panel.spec.ts`, `app.spec.ts`, `history.spec.ts`.

**Created:**
- `angular/src/app/Components/history/age.ts` + `age.spec.ts` — the pure helper, Unit 5.
- `testing/check_ui.mjs` — the browser check, Unit 7.

---

## Task 1: A lighter dim and a blur behind the shortcuts panel

**Files:**
- Modify: `angular/src/styles.css:233-236` (the `html.shortcuts-open .app` rule)
- Modify: `angular/src/app/Components/shortcuts-panel/shortcuts-panel.css:2-6` (`.backdrop`)
- Test: `angular/src/app/Components/shortcuts-panel/shortcuts-panel.spec.ts`

**Interfaces:**
- Consumes: nothing. The panel toggles the class `shortcuts-open` on `<html>` in `shortcuts-panel.ts:29-32`, and that hook already works.
- Produces: nothing other tasks use.

**Note before you start:** jsdom cannot see a blur or an opacity, so **there is no failing test to drive this task**. The test below is a regression net over the hook the CSS depends on; the real proof is Task 7's screenshot. Do not pretend otherwise in the commit message.

- [x] **Step 1: Add the regression test for the hook**

In `angular/src/app/Components/shortcuts-panel/shortcuts-panel.spec.ts`, inside the existing `describe('ShortcutsPanel reset')`, add this test. Its `beforeEach` already opens the panel (`keys.togglePanel(true)`), so the class should already be on:

```ts
  // The page steps aside behind the panel (styles.css). jsdom can't see the dim or the blur, so this only pins the hook.
  it('marks the page while the panel is open, and clears the mark when it closes', () => {
    expect(document.documentElement.classList.contains('shortcuts-open')).toBe(true);

    keys.togglePanel(false);
    fixture.detectChanges();

    expect(document.documentElement.classList.contains('shortcuts-open')).toBe(false);
  });
```

- [x] **Step 2: Run it — it passes already, and that is correct**

Run: `node node_modules\@angular\cli\bin\ng.js test --watch=false` (from `angular/`)
Expected: PASS. The class has always been toggled; this test exists so a later rename of it fails loudly instead of silently un-blurring the page.

- [x] **Step 3: Lighten the dim**

In `angular/src/styles.css`, in the `html.shortcuts-open .app` rule, change `opacity: 0.6;` to `opacity: 0.85;`. Leave the `translateX(-3%) scale(0.95)` line alone.

- [x] **Step 4: Blur the page through the panel's backdrop**

In `angular/src/app/Components/shortcuts-panel/shortcuts-panel.css`, add two lines inside `.backdrop{ … }` (which today has only `position: fixed; inset: 0; z-index: 40;`):

```css
    /* What the page looks like through here, so the panel is the only sharp thing on screen */
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
```

Do **not** put `filter: blur()` on `.app` instead: it would stop the nav pill's own backdrop-filter from sampling the body gradient, and the blur would bleed at the edges of the scaled page. The backdrop is a sibling of `.app` (`app.html:81` vs `:83-86`), so it samples the page and leaves the panel sharp.

- [x] **Step 5: Run the tests and the build**

Run from `angular/`: `node node_modules\@angular\cli\bin\ng.js test --watch=false` then `node node_modules\@angular\cli\bin\ng.js build`
Expected: Tests `15 files / 112 tests`, build exit 0.

- [x] **Step 6: Commit (only if the user asks)**

```bash
git add angular/src/styles.css angular/src/app/Components/shortcuts-panel/shortcuts-panel.css angular/src/app/Components/shortcuts-panel/shortcuts-panel.spec.ts
git commit -m "the page behind the shortcuts panel dims less and blurs, so the panel is the focus

Contributor: deepseek flash"
```

---

## Task 2: Fields and History back on the normal nav

**Files:**
- Modify: `angular/src/app/app.routes.ts:18-19`
- Test: `angular/src/app/app.spec.ts:39`, `:48`, and the crowded-nav test at `:125`

**Interfaces:**
- Consumes: nothing.
- Produces: `/history` and `/fields` render with the crowded nav and the hero header. `app.ts:17` derives its `adminPaths` list from the same route data, so removing the flag is the only change needed there.

**The trap:** `app.spec.ts:58` supplies its own inline stub route with `admin: true` for `'/history'`, so several shell tests keep passing after this change while the real app is broken. **Two** assertions catch it: the route-table one at line 48, and the first-paint test at `:82-89`, which pushes `/history` and reads the **real** route table through `app.ts:17` — its inline stub is irrelevant because no navigation happens in that test. Both were confirmed by running them, not by reading them.

- [x] **Step 0: Clear the warning you will see in every build**

Every `ng build` and `ng test` currently prints `NG8113: 'RouterLink' is declared but its value is never read` pointing at `angular/src/app/Components/account/account.ts:11`. It is there because the admin-page links on that card were parked in an HTML comment earlier, leaving the import unused. Remove `RouterLink` from that component's `imports` array, and add one line to the parked comment in `account.html` saying the `RouterLink` import returns with the block. Both commands must then print no warnings at all.

- [x] **Step 1: Write the failing expectation**

In `angular/src/app/app.spec.ts`, line 39, change the list to:

```ts
  const adminPaths = ['overview', 'settings'];
```

and line 48's expectation to:

```ts
    expect(adminPaths.map(isAdminRoute)).toEqual([true, true]);
```

Also change line 39's neighbours: keep `expect(isAdminRoute('')).toBe(false);` and `expect(isAdminRoute('requests')).toBe(false);`, and add:

```ts
    expect(isAdminRoute('history')).toBe(false);
    expect(isAdminRoute('fields')).toBe(false);
```

**One more line, because removing the flag breaks a second test.** In `angular/src/app/app.spec.ts`, the test `'is already the admin shell on the first paint, before the router has settled'` pushes the address `/history` and relies on the **real** route table for the pre-router first paint, so it fails once `/history` stops being an admin page (`expected null to be truthy`, at the `nav.admin-nav` assertion). Change that pushed address to `/overview`, which is still an admin page: the test keeps its intent — the first paint is already the admin shell — and the suite goes green. Do not touch its inline stub router.

- [x] **Step 2: Run it to watch it fail**

Run from `angular/`: `node node_modules\@angular\cli\bin\ng.js test --watch=false`
Expected: FAIL — `history` and `fields` still carry `admin: true` in the route table.

- [x] **Step 3: Drop the flag from the two routes**

In `angular/src/app/app.routes.ts`, remove `admin: true` from the `history` (line 18) and `fields` (line 19) routes, leaving `canActivate: [adminGuard]` and the rest untouched.

- [x] **Step 4: Pin that the crowded nav still offers them**

In `angular/src/app/app.spec.ts`, in the test at line 125 (`'keeps Overview and People out of the crowded nav, and sends the name item to Settings'`), add beside the existing assertions:

```ts
    expect(nav.querySelector('a[href="/history"]')).toBeTruthy();
    expect(nav.querySelector('a[href="/fields"]')).toBeTruthy();
```

- [x] **Step 5: Run the tests and the build**

Run from `angular/`: tests then build.
Expected: 15 files / 112 tests passing, build exit 0.

- [x] **Step 6: Check it in the browser**

Load `http://localhost:4200/fields` and `http://localhost:4200/history` signed in as an admin. Expected: the crowded nav, with the current page highlighted, and the page's own title below it — not the slim nav.

- [x] **Step 7: Commit (only if the user asks)**

```bash
git add angular/src/app/app.routes.ts angular/src/app/app.spec.ts
git commit -m "fields and history use the normal nav again, so the nav always shows the page you are on

Contributor: deepseek flash"
```

---

## Task 3: The API asks for a note, not the word RESTORE

**Files:**
- Modify: `api_v2/Endpoints/HistoryEndpoints.cs:15` (the record), `:105-108` (the gate), `:123` (the copy)
- Modify: `testing/check_big.py:23`, `testing/stress.py:78` (they post the old word)

**Interfaces:**
- Consumes: nothing.
- Produces: `POST /history/versions/{id}/restore` now takes `{ "note": "…" }` with at least 10 characters after trimming. **Task 4 depends on this exact field name and this exact minimum.**

- [x] **Step 1: Prove the current behaviour fails the new contract**

With the API running (`dotnet run --launch-profile http` from `api_v2/`, on port 5005), sign in and post a note instead of the word. Save this as `%TEMP%\note-check.ps1` and run it:

```powershell
$control = Get-Content 'scripts/seeding.control.toml' -Raw
$user = [regex]::Match($control, '(?m)^\s*username\s*=\s*"?([^"\r\n]*)"?').Groups[1].Value.Trim()
$pass = [regex]::Match($control, '(?m)^\s*password\s*=\s*"?([^"\r\n]*)"?').Groups[1].Value
$login = Invoke-RestMethod -Method Post -Uri 'http://localhost:5005/auth/login' -ContentType 'application/json' -Body (@{ username = $user; password = $pass } | ConvertTo-Json)
$h = @{ Authorization = "Bearer $($login.token)" }
$versions = Invoke-RestMethod -Uri 'http://localhost:5005/history/versions' -Headers $h
$id = $versions[0].id
try {
  Invoke-RestMethod -Method Post -Uri "http://localhost:5005/history/versions/$id/restore" -Headers $h -ContentType 'application/json' -Body (@{ note = 'a note long enough' } | ConvertTo-Json)
  "  UNEXPECTED: it restored"
} catch {
  "  refused as expected: HTTP $([int]$_.Exception.Response.StatusCode)"
}
```

Run: `pwsh -File $env:TEMP\note-check.ps1`
Expected: `refused as expected: HTTP 400` — today only the word `RESTORE` is accepted. **This script must never send `{"confirm":"RESTORE"}`.**

- [x] **Step 2: Change the record and the gate**

In `api_v2/Endpoints/HistoryEndpoints.cs:15`:

```csharp
public record RestoreBody(string? Note);
```

and at `:105-108`, replacing the `Confirm` check:

```csharp
            var note = body.Note?.Trim();
            if (note is null || note.Length < 10)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["note"] = ["Write a few words about why, at least 10 characters"] });
            }
```

- [x] **Step 3: Keep the note with the copy it saves**

At `:123`, pass the note into the reason so History explains why the restore happened:

```csharp
                copyId = await collector.SaveVersionAsync($"Before restoring version {id} — {note}", user.Name, ct, applyRetention: false);
```

The em dash is deliberate: `history.ts`'s `describe()` prefix-matches `Before restoring version {id}`, and Task 4 adds the branch that keeps the text after it. No database change: `reason` already exists.

- [x] **Step 4: Update the two checks that post the old word**

- `testing/check_big.py:23`: change `{"confirm": "RESTORE"}` to `{"note": "restoring every row to check the count"}`.
- `testing/stress.py:78`: same change, with any phrase of 10 characters or more.

Leave `testing/check_restore.py` alone — it exercises the **backup** card, which keeps its typed `RESTORE` gate.

**Careful — both files hold two restore calls each, for different endpoints.** In `testing/check_big.py` line 23 restores a **saved version** (change it) while line 40 restores a **backup** (leave it). In `testing/stress.py` line 78 is the saved version (change it) and line 76 is a backup (leave it). Never use a blind find-and-replace for this step; edit the two named lines and nothing else. Verified by search: the saved-version endpoint is called from exactly these two lines anywhere under `testing/`.

- [x] **Step 5: Build and re-run the check**

Run from `api_v2/`: `dotnet build -c Release` → expected 0 warnings, 0 errors.
Restart the API, then run `pwsh -File $env:TEMP\note-check.ps1` again.
Expected: no exception — the restore succeeds, and `GET /history/versions` now shows a new entry whose reason starts `Before restoring version` and ends with your note.

- [x] **Step 6: Commit (only if the user asks)**

```bash
git add api_v2/Endpoints/HistoryEndpoints.cs testing/check_big.py testing/stress.py
git commit -m "restoring a saved version asks for a note instead of the word restore, and keeps it with the copy it saves

Contributor: deepseek flash"
```

---

## Task 4: The History panel asks for that note

**Files:**
- Modify: `angular/src/app/services/industry-api.ts:77-79`
- Modify: `angular/src/app/Components/history/history.ts:31`, `:171-179`, `:196-197`, `:266-275`
- Modify: `angular/src/app/Components/history/history.html:165-178`
- Test: `angular/src/app/Components/history/history.spec.ts`

**Interfaces:**
- Consumes: Task 3's `{ note }` field and its 10-character minimum.
- Produces: `page.restoreNote()` (a signal), `page.restore()` gated on `restoreNote().trim().length >= 10`.

- [x] **Step 1: Write the failing test**

In `angular/src/app/Components/history/history.spec.ts`, inside `describe('HistoryPage')`, using the file's existing `setup()` (which already flushes `[version(2, true), version(1)]`):

```ts
  // The word RESTORE is replaced by a note that says why, and the note is kept with the copy the restore saves
  it('asks for a note before restoring a saved version', () => {
    const fixture = setup();
    const page = fixture.componentInstance;

    page.askRestore(version(1));
    fixture.detectChanges();

    // Scoped to the panel on purpose: the Backups card further down this same page keeps its own typed RESTORE,
    // so a whole-page assertion would fail for the wrong reason.
    const panel = (fixture.nativeElement as HTMLElement).querySelector('#version-panel') as HTMLElement;
    expect(panel.textContent).not.toContain('Type RESTORE');
    expect(page.restoreNote()).toBe('');

    // Too short: nothing is sent
    page.restoreNote.set('too short');
    page.restore();
    http.expectNone(r => r.method === 'POST' && r.url.endsWith('/restore'));

    // Long enough: the note travels with it
    page.restoreNote.set('swapping in the october rows');
    page.restore();
    const call = http.expectOne(r => r.method === 'POST' && r.url.endsWith('/restore'));
    expect(call.request.body).toEqual({ note: 'swapping in the october rows' });
    call.flush({ restored: 3, skipped: 0, lostValues: 0, rulesRestored: 0, requestId: null });
  });

  // The stored reason now carries the note, and the page still reads it as words
  it('reads a saved note back off the reason', () => {
    const fixture = setup();
    const page = fixture.componentInstance;

    expect(page.describe('Before restoring version 2 — swapping in the october rows'))
      .toBe('Before restoring version #2 — swapping in the october rows');
  });
```

- [x] **Step 2: Run it to watch it fail**

Run from `angular/`: `node node_modules\@angular\cli\bin\ng.js test --watch=false`
Expected: FAIL — `page.restoreNote` does not exist, and the page still says "Type RESTORE".

- [x] **Step 3: Rename the state and gate it on length**

In `angular/src/app/Components/history/history.ts`:

```ts
  restoreNote = signal('');
```

replace the reset at `:196-197` so the note is cleared too when the panel opens or closes, and replace `restore()` at `:266-275`:

```ts
  restore() {
    const p = this.panel();
    const note = this.restoreNote().trim();
    if (p?.kind !== 'restore' || note.length < 10) return;
    this.busy.set(true);
    this.panelError.set('');
    this.api.restore(p.version.id, note).subscribe({
      next: result => { this.busy.set(false); this.restoreDone.set(result); this.load(); },
      error: (err: HttpErrorResponse) => { this.busy.set(false); this.panelError.set(errorText(err)); },
    });
  }
```

- [x] **Step 4: Keep the note readable in `describe()`**

At `history.ts:171-179`, the existing branch is `return \`Before restoring version #${m?.[1]}\`;`. Replace that one line with:

```ts
    if (reason.startsWith('Before restoring version')) {
      // The id sits before the note, so it cannot come from the trailing-digits match above: with a note appended
      // there are no trailing digits at all, and that match returns null.
      const [id, note] = reason.slice('Before restoring version '.length).split(' — ');
      return note ? `Before restoring version #${id} — ${note}` : `Before restoring version #${id}`;
    }
```

- [x] **Step 5: Send the note from the client**

In `angular/src/app/services/industry-api.ts:77-79`, the body becomes `{ note }`:

```ts
  restore(id: number, note: string) {
    return this.http.post<RestoreResult>(`${this.apiUrl}/history/versions/${id}/restore`, { note });
  }
```

- [x] **Step 6: Replace the field in the panel**

In `angular/src/app/Components/history/history.html:165-178`, replace the label, the input and the disabled rule:

```html
                    <div class="confirm-row">
                        <label class="field">
                            <span class="field-label">Say why, in a few words</span>
                            <span class="control">
                                <i class="fa-solid fa-keyboard" aria-hidden="true"></i>
                                <input autocomplete="off" placeholder="Why go back to this copy?" [value]="restoreNote()" (input)="restoreNote.set($any($event.target).value)">
                            </span>
                        </label>
                        <button type="button" class="cancel-btn" (click)="close()">Cancel</button>
                        <button type="button" class="add-btn danger" [disabled]="restoreNote().trim().length < 10 || busy()" (click)="restore()">
                            @if (busy()) { <i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>Restoring }
                            @else { <i class="fa-solid fa-rotate-left" aria-hidden="true"></i>Restore }
                        </button>
                    </div>
```

- [x] **Step 7: Run the tests and the build**

Run from `angular/`: tests then build.
Expected: 15 files / 112 tests passing, build exit 0.

- [x] **Step 8: Commit (only if the user asks)**

```bash
git add angular/src/app/Components/history/history.ts angular/src/app/Components/history/history.html angular/src/app/Components/history/history.spec.ts angular/src/app/services/industry-api.ts
git commit -m "the history panel asks why before restoring a saved copy, in place of typing restore

Contributor: deepseek flash"
```

---

## Task 5: The restore panel glows, then fades

**Files:**
- Modify: `angular/src/app/Components/history/history.css` (new rules; nothing there uses `--signal` yet)
- Modify: `angular/src/app/Components/history/history.html` (the panel element)
- Test: `angular/src/app/Components/history/history.spec.ts`

**Interfaces:**
- Consumes: the panel markup from Task 4 (the restore panel is `#version-panel`).
- Produces: the class `glow` on `#version-panel` while a restore is being asked about.

- [x] **Step 1: Write the failing test**

Add to `history.spec.ts`:

```ts
  // Orange flash on the way in, so the eye lands on the question. jsdom can't see the animation itself; Task 7 does.
  it('marks the restore panel so it can glow as it opens', () => {
    const fixture = setup();
    const page = fixture.componentInstance;

    page.askRestore(version(1));
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('#version-panel.glow')).toBeTruthy();

    page.close();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('#version-panel.glow')).toBeFalsy();
  });
```

- [x] **Step 2: Run it to watch it fail**

Run from `angular/`: tests.
Expected: FAIL — no `glow` class yet.

- [x] **Step 3: Add the class to the panel**

In `history.html`, the panel section is `<section class="panel" id="version-panel">` at `:81-82`. Change it to:

```html
    <section class="panel" [class.glow]="panel()?.kind === 'restore'" id="version-panel">
```

- [x] **Step 4: Write the glow in `history.css`**

Append near the `.confirm-row` block (`:170-187`):

```css
/* The restore question lands with a flash of the signal colour, then settles. Inside @if (panel()), so it plays each time. */
@keyframes restore-glow{
    0%{
        box-shadow: 0 0 0 0 transparent;
    }
    35%{
        box-shadow: 0 0 0 4px var(--signal), 0 0 28px 4px var(--signal);
    }
    100%{
        box-shadow: 0 0 0 0 transparent;
    }
}

.panel.glow{
    animation: restore-glow 1.4s ease-out both;
}

@media (prefers-reduced-motion: reduce){
    .panel.glow{
        animation: none;
    }
}
```

- [x] **Step 5: Run the tests and the build**

Run from `angular/`: tests then build.
Expected: 15 files / 112 tests passing, build exit 0.

- [x] **Step 6: Commit (only if the user asks)**

```bash
git add angular/src/app/Components/history/history.css angular/src/app/Components/history/history.html angular/src/app/Components/history/history.spec.ts
git commit -m "the restore question flashes the signal colour as it opens, and stays still for people who asked for less motion

Contributor: deepseek flash"
```

---

## Task 6: "How old is this" beside each saved version

**Files:**
- Create: `angular/src/app/Components/history/age.ts`
- Create: `angular/src/app/Components/history/age.spec.ts`
- Modify: `angular/src/app/Components/history/history.html:52`

**Interfaces:**
- Consumes: nothing.
- Produces: `export function age(iso: string, now = Date.now()): string` — hours under a day, days and hours at a day or more.

- [x] **Step 1: Write the failing test**

Create `age.spec.ts`:

```ts
import { age } from './age';

// "How old is this" in words, for the saved copies list on History
describe('age', () => {
  const now = Date.parse('2026-10-08T12:00:00Z');
  const ago = (iso: string) => age(iso, now);

  it('reads in hours under a day', () => {
    expect(ago('2026-10-08T11:00:00Z')).toBe('1 hour');
    expect(ago('2026-10-08T03:00:00Z')).toBe('9 hours');
    expect(ago('2026-10-07T13:00:00Z')).toBe('23 hours');
  });

  it('reads in days and hours from a day on', () => {
    expect(ago('2026-10-07T12:00:00Z')).toBe('1 day');
    expect(ago('2026-10-07T08:00:00Z')).toBe('1 day 4 hours');
    expect(ago('2026-10-06T12:00:00Z')).toBe('2 days');
    expect(ago('2026-10-06T09:00:00Z')).toBe('2 days 3 hours');
    expect(ago('2026-10-06T11:00:00Z')).toBe('2 days 1 hour');
  });

  it('says less than an hour rather than counting minutes', () => {
    expect(ago('2026-10-08T11:59:00Z')).toBe('less than an hour');
    expect(ago('2026-10-08T12:00:00Z')).toBe('less than an hour');
  });

  it('never reads as a negative when a clock is ahead of ours', () => {
    expect(ago('2026-10-08T13:00:00Z')).toBe('less than an hour');
  });

  it('says nothing at all for a date it cannot read', () => {
    expect(ago('')).toBe('');
    expect(ago('not a date')).toBe('');
  });
});
```

- [x] **Step 2: Run it to watch it fail**

Run from `angular/`: tests.
Expected: FAIL — `Cannot find module './age'`.

- [x] **Step 3: Write the helper**

Create `age.ts`:

```ts
// How long ago something was saved, in words: "9 hours", or "1 day 4 hours" once it is a day old.
// Under an hour reads as "less than an hour" rather than counting minutes. `now` is a parameter so a test needs no clock.
export function age(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';

  const minutes = Math.floor(Math.max(0, now - then) / 60000);
  if (minutes < 60) return 'less than an hour';

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? '1 hour' : `${hours} hours`;

  const days = Math.floor(hours / 24);
  const left = hours % 24;
  const dayPart = days === 1 ? '1 day' : `${days} days`;
  if (left === 0) return dayPart;
  return `${dayPart} ${left === 1 ? '1 hour' : `${left} hours`}`;
}
```

- [x] **Step 4: Run the tests again**

Run from `angular/`: tests.
Expected: `age` passes all five cases.

- [x] **Step 5: Show it on the page**

In `history.html:52`, the saved-version line becomes (the exact date stays, the age joins it):

```html
                    <span class="sub">{{ formatDate(v.createdAt) }} · {{ howOld(v.createdAt) }} · {{ v.damaged ? "Can't be restored or brought back" : v.sameLayout ? 'Same table layout' : 'Other table layout' }}</span>
```

and in `history.ts` import it and expose it under a name the template can reach — a template can only call members of the component, never an imported function directly:

```ts
import { age } from './age';
```

```ts
  // The template can only call members, so the helper is handed to it under the name the row uses
  readonly howOld = age;
```

- [x] **Step 6: Assert it reaches the row**

Add to `history.spec.ts`:

```ts
  it('says how old each saved copy is', () => {
    const fixture = setup();
    const rows = (fixture.nativeElement as HTMLElement).querySelectorAll('table.versions tbody tr');
    expect(rows[0].textContent).toMatch(/less than an hour|hours|day/);
  });
```

- [x] **Step 7: Run the tests and the build**

Run from `angular/`: tests then build.
Expected: 15 files / 112 tests passing, build exit 0.

- [x] **Step 8: Commit (only if the user asks)**

```bash
git add angular/src/app/Components/history/age.ts angular/src/app/Components/history/age.spec.ts angular/src/app/Components/history/history.html angular/src/app/Components/history/history.ts angular/src/app/Components/history/history.spec.ts
git commit -m "each saved copy says how old it is, in hours under a day and days and hours after that

Contributor: deepseek flash"
```

---

## Task 7: The browser check that proves the visual work

**Files:**
- Create: `testing/check_ui.mjs`

**Interfaces:**
- Consumes: everything above. It signs in with `scripts/seeding.control.toml` (never printing the password) and reads the app on `http://localhost:4200` with the API on `5005`.
- Produces: screenshots in the folder given as the first argument, and a non-zero exit when an expectation fails.

- [ ] **Step 1: Write the check**

Create `testing/check_ui.mjs`. Playwright is already installed in `testing/`; `createRequire` is used so the script also runs from anywhere:

```js
// Signs in and looks at the five changes that jsdom cannot see. Opens the restore question but never confirms one.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = process.argv[2] ?? path.join(repo, 'testing', 'screenshots');
fs.mkdirSync(out, { recursive: true });

const control = fs.readFileSync(path.join(repo, 'scripts', 'seeding.control.toml'), 'utf8');
const field = (n) => (control.match(new RegExp(`^\\s*${n}\\s*=\\s*"?([^"\\r\\n]*?)"?\\s*$`, 'm')) || [])[1] || '';

const app = process.env.APP_URL ?? 'http://localhost:4200';
const host = new URL(app).hostname;
if (host !== 'localhost' && host !== '127.0.0.1') throw new Error(`refusing to run against ${host}: this check is for localhost only`);
const fails = [];
const check = (label, ok) => { console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}`); if (!ok) fails.push(label); };
const shot = (page, name) => page.screenshot({ path: path.join(out, `${name}.png`) });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });

await page.goto(`${app}/login`, { waitUntil: 'domcontentloaded' });
await page.locator('input:not([type=password])').first().fill(field('username').trim());
await page.locator('input[type=password]').first().fill(field('password'));
await page.locator('button[type=submit]').first().click();
await page.waitForFunction(() => !location.pathname.startsWith('/login'), null, { timeout: 20000 });

// 1. Fields and History use the normal nav
for (const route of ['fields', 'history']) {
  await page.goto(`${app}/${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  check(`/${route} uses the normal nav`, await page.locator('nav.nav').count() === 1 && await page.locator('nav.admin-nav').count() === 0);
  check(`/${route} marks itself as the current page`, await page.locator(`nav.nav a[href="/${route}"].active`).count() > 0);
  await shot(page, route);
}

// 2. The restore question asks for a note, and glows
await page.goto(`${app}/history`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
await page.locator('table.versions tbody tr').first().getByRole('button', { name: /Restore/ }).first().click();
await page.waitForTimeout(400);
const panel = page.locator('#version-panel');
check('the panel glows as it opens', await panel.evaluate((n) => n.classList.contains('glow')));
check('it asks for a note, not the word RESTORE', !(await panel.textContent()).includes('Type RESTORE'));
const restoreBtn = panel.getByRole('button', { name: /^Restore$/ }).first();
check('Restore is disabled with nothing written', await restoreBtn.isDisabled());
await panel.locator('input').first().fill('nine char');
check('Restore is still disabled at 9 characters', await restoreBtn.isDisabled());
await panel.locator('input').first().fill('long enough to count');
check('Restore turns on at 10 characters or more', !(await restoreBtn.isDisabled()));
await shot(page, 'restore-note');
await page.keyboard.press('Escape').catch(() => {});

// 3. The age line sits beside the saved copy
check('a saved copy says how old it is', /\d+ (hour|hours|day|days)|less than an hour/.test(await page.locator('table.versions tbody tr').first().textContent()));

// 4. The shortcuts panel dims less and blurs what is behind it
await page.goto(`${app}/overview`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);
await page.keyboard.press('?');
await page.waitForSelector('.panel.pop', { timeout: 15000 });
await page.waitForTimeout(600);
check('the page steps aside for it', await page.evaluate(() => document.documentElement.classList.contains('shortcuts-open')));
check('the backdrop blurs what is behind it', await page.locator('.backdrop').evaluate((n) => getComputedStyle(n).backdropFilter.includes('blur')));
check('the page dims only a little', await page.locator('.app').evaluate((n) => Number(getComputedStyle(n).opacity) > 0.8));
await shot(page, 'shortcuts-blur');

// 5. Closing the panel by its own path must clear the mark. The unit test drives the service directly, so it cannot catch this.
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
check('closing the panel clears the mark', !(await page.evaluate(() => document.documentElement.classList.contains('shortcuts-open'))));

// 6. The same, with the theme the other way round. The backdrop covers the page on purpose, so the panel has to be closed
//    before the theme button can be clicked at all - a real behaviour of this design, learned by trying it.
await page.locator('.theme-btn').click();
await page.waitForTimeout(800);
await page.keyboard.press('?');
await page.waitForSelector('.panel.pop', { timeout: 15000 });
await page.waitForTimeout(900);
check('the backdrop blurs in dark mode too', await page.locator('.backdrop').evaluate((n) => getComputedStyle(n).backdropFilter.includes('blur')));
await shot(page, 'shortcuts-blur-dark');

await browser.close();
console.log(fails.length ? `\n${fails.length} failed` : '\nall checks passed');
process.exit(fails.length ? 1 : 0);
```

- [ ] **Step 2: Run it**

Run from `testing/`: `node check_ui.mjs ..\..\dsh-shots\after` (or any folder you like).
Expected: every line reads `ok`, then `all checks passed`, exit code 0. Screenshots land in the folder you named.

- [ ] **Step 3: Commit (only if the user asks)**

```bash
git add testing/check_ui.mjs
git commit -m "a browser check that signs in and looks at the five changes jsdom cannot see

Contributor: deepseek flash"
```

---

## Task 8: `HANDOFF.md` carries the Scratchpad

**Files:**
- Modify: `HANDOFF.md` (repo root; tracked, though listed in `.gitignore`)

**Interfaces:**
- Consumes: the current state after Tasks 1-7. If Task 2 has not landed, the section will be wrong about the nav.
- Produces: the brief for the next session. No code depends on it.

- [ ] **Step 1: Add the section**

Add a `## The Scratchpad (next session, its own project)` section, in the file's existing style (bold lead-in label, then the rule, short declarative sentences). It must carry:

- **What it is and where the design lives:** `design/Scratchpad-Light.dc.html`, `design/README.md`, and the Scratchpad part of `OVERVIEW_HANDOFF.md`.
- **The decisions still needing the user's yes:** storage and the model are approved in principle, but the **table and field names must be confirmed**, the **25 MB file limit is a placeholder the user has never chosen**, and a **migration is required**.
- **The build order the user asked for:** their items a, b, d, then c, f, g, and **e (files) only after they confirm file storage**.
- **Essential, do not ship without it:** **undo (`Ctrl+Z`) and redo (`Ctrl+Y` / `Ctrl+Shift+Z`)**, which is also why nothing on that page asks "are you sure". A line glued to two cards stays glued; new things appear in free space; saved per person automatically, with no Save button.
- **Closed — do not build:** the "Apply anyway" button for keeping one key on two functions; the user decided against it.
- **Refused:** Word, PowerPoint and Excel files. The SVG and executable question is the implementer's call.
- **What exists today:** no Scratchpad code, route, service or tab anywhere in the repo. The two hooks waiting for it are the comment in `app.html` beside the tabs and `shortcuts.ts`'s `ADMIN_PAGES` / `Scope` union.
- **What it inherits:** Overview and Settings are the admin tabs; History and Fields are on the normal nav; People, Rename, admin notes and Delete account live inside Settings; the database is the user's own PostgreSQL 18 with `main` and `collector`; and `app.spec.ts` pins the admin tabs to exactly `['Overview', 'Settings']`, so the new tab changes that assertion.
- **Three things wrong in the file itself**, all worth fixing while it is open:
  - `plan.md` is pointed at on **four** lines (3, 21, 45 and 80) and does not exist in the repo root — only `report.txt` does. Fix every reference, not just the first.
  - The "Waiting on the user" item about the Overview says it awaits a design, though the Overview is built and committed.
  - Line 45 pins the commit footer as `Contributor: opus 5.5`, but the repo's recent commits say `coder bot` and today's say `deepseek flash`. Do not pin a stale name: say plainly that the footer names whoever did the work, and keep the rest of the rule (one plain lowercase line, no co-author line).

- [ ] **Step 2: Read it back as a stranger**

Read the new section alone. It is done when it answers: what, where, what is decided, what is not, and what is essential — with no question left that the next session would have to ask.

- [ ] **Step 3: Commit (only if the user asks)**

```bash
git add HANDOFF.md
git commit -m "handoff carries what the next session needs for the scratchpad, and stops claiming the overview waits on a design

Contributor: deepseek flash"
```

---

## Verification, and the one hole in it

**Per task:** the step's own test, then `ng test`, then `ng build` (or `dotnet build -c Release` for Task 3).

**Per batch:** `node testing/check_ui.mjs <folder>` — every line `ok`, exit 0, screenshots in light and dark. A green unit suite proves almost nothing about Units 1, 4 and 5, because jsdom cannot see a blur, an animation or an opacity.

**The user's own verification loop**, given on 2026-10-08 and now closed:

1. **A critic subagent judges the work, not the implementer.** It scans the repo, writes its own detailed rubric, and scores out of 10. **6 passes; below 6 loops, up to three times.**
2. **Judgement happens in the real frontend**, driven with Playwright as a regular user: click around, change the theme, try the awkward paths. Anything off in the UI or UX is reported and **deducts points**. No claim is taken on trust — if the controller or an implementer wrote "this should pass", the critic verifies it or marks it unproven.
3. **An implementer may consult** before starting: up to **two** advisor subagents per round, on how to approach the work well.
4. **After three failed passes, stop.** Report what failed and why, and stop retrying.
