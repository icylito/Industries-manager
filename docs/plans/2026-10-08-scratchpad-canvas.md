# Scratchpad, slice a: the endless canvas

Design for the first Scratchpad slice. Written 2026-10-08 for the `scratchpad-canvas` branch.
Read [OVERVIEW_HANDOFF.md](../../OVERVIEW_HANDOFF.md) for the full brief; this file covers only slice a.

**Nothing is built yet.** This is a spec for review, not a plan of commits.

## What this slice is

An admin-only page at `/scratchpad`: one endless canvas that holds **industry cards** and **sticky notes / text boxes**. Pan, zoom, fit, zoom to what is selected, new things land in free space, **undo and redo work everywhere**, and the whole board is **saved per person on the server** with no Save button.

The reason for the page, in the brief's words: a place to think with your industries, that feels like a table with paper on it, quick and forgiving, with nothing to learn.

## What is in, and what waits

| In slice a | Waits for its own slice |
|---|---|
| Endless canvas: pan, zoom (10%–400%), fit, zoom to selection, 100% | `b` select several at once (box select, Shift+click) |
| Industry cards, sticky notes, text boxes: add, move, edit, delete | `c` groups under a label |
| Single selection | `d` bold and highlight on selected words, per-word fonts |
| Undo / redo, capped history | `e` carry tray, snapshots, file upload (needs the 25 MB decision and its own table) |
| Per-person board saved on the server, debounced, no Save button | `f` line labels, arrowheads, curves |
| View (position and zoom) remembered per person | `g` full shortcuts panel work: Mouse rows, per-modifier rebinding, keys and theme on the server, saved views |

## Decisions taken

| Decision | Choice | Why |
|---|---|---|
| Storage | One `jsonb` document per person | Matches `Industries.Extra`, `RuleVersions.Fields` and `Settings.Value`; later item kinds (lines, groups, files) need **no second migration** |
| Canvas | DOM items on one CSS-transform layer | Text editing and accessibility come free, and it matches the hand-built SVG/CSS style the repo already uses |
| Undo | Snapshot stack, capped at 100 | The board is small; "undo reverses the whole move in one step" falls out naturally |
| Branch | `scratchpad-canvas`, off local `main` | The brief says the Scratchpad gets its own branch |

## Data model

### New table

**`ScratchBoards`** — one row per person.

| Column | Type | Notes |
|---|---|---|
| `Id` | integer, PK, identity | |
| `UserId` | integer, **unique**, FK → `Users.Id`, cascade delete | the person; deleting an account takes its board |
| `Document` | `jsonb`, not null | the whole board |
| `CreatedAt` | timestamp with time zone | |
| `UpdatedAt` | timestamp with time zone | when it was last saved |

Entity `Model/ScratchBoard.cs`, `DbSet<ScratchBoard> ScratchBoards` on [AppDbContext.cs](../../api_v2/Data/AppDbContext.cs), and in `OnModelCreating`: `Document` as `jsonb`, unique index on `UserId`, cascade FK to `Users`, following [UserNote.cs](../../api_v2/Model/UserNote.cs).

### The document

```json
{
  "version": 1,
  "view": { "x": 0, "y": 0, "zoom": 1 },
  "items": [
    { "id": "…", "type": "industry", "x": 40, "y": 56, "w": 236, "h": 82,
      "industryId": 12, "name": "Horizon Water LLC", "sector": "Private Sector",
      "price": 12.5, "rank": 3 },
    { "id": "…", "type": "note", "x": 360, "y": 70, "w": 250, "h": 120,
      "text": "To check", "tone": "white", "tilt": -2 },
    { "id": "…", "type": "text", "x": 360, "y": 300, "w": 270, "h": 90,
      "text": "Next steps", "tone": "white", "tilt": 0 }
  ]
}
```

- `version` lets a later slice change the shape without guessing. Readers that meet an unknown version refuse the board with a plain message rather than mangling it.
- `view.x` and `view.y` are the pan offset in screen pixels; `view.zoom` is 0.1 to 4. The view is saved but **not** part of undo history.
- `x`, `y`, `w`, `h` are world coordinates. `h` is an estimate used to place new things and to keep them from landing on top of each other; the real height is read from the page after a draw.
- Item ids are strings made by `crypto.randomUUID()` in the page. They are only unique inside one document.
- `tone` is a paper colour name (`white`, `amber`), never a raw colour. Colours come from the CSS variables.
- `tilt` is a small cosmetic rotation in degrees for notes and text.
- **Reserved for later slices, added to this same document with no migration:** `lines`, `groups`, `strokes`, and item types `snap` and `file`.

### Industry cards keep a snapshot

A card stores `industryId` **and** the name, sector and price it showed when it was added, plus a rank when it came from a ranked list (`rank` may be null). When the board loads, cards are refreshed from the current table so a price is never stale. If the industry is gone from the table, the card keeps its last snapshot and is left as it is (slice a does not mark it "gone"; that can come later).

## API

New `Endpoints/ScratchpadEndpoints.cs`, registered in [Program.cs](../../api_v2/Program.cs) as `app.MapScratchpad();`, every endpoint behind `RequireAdmin()` from [CurrentUser.cs](../../api_v2/Auth/CurrentUser.cs) so widening access later is one line, and `RequireDatabaseReady()` like the rows group so a database that is down answers plainly instead of throwing.

| Endpoint | Body | Answers |
|---|---|---|
| `GET /scratchpad` | — | `{ "document": {…}, "updatedAt": "…\|null" }`. No row means an empty document with `updatedAt: null`; a read never writes |
| `PUT /scratchpad` | `{ "document": {…}, "updatedAt": "…\|null" }` | Saves the board and answers `{ "updatedAt": "…" }`. `updatedAt` is an optional guard: if it does not match the stored value the save is refused with a plain "This board was changed somewhere else" so two tabs cannot silently overwrite each other |
| `DELETE /scratchpad` | — | Clears the board |

**Checks on the way in** (done by hand in the endpoint, not by data annotations, because the document is free form):
- serialized document at most **1 MB**;
- `version` is one this build knows;
- `items` is an array of at most **500**;
- each item's `type` is a known one, and `x`, `y`, `w`, `h` are finite numbers;
- `text` is a string of at most **10 000** characters;
- `view.zoom` is clamped to 0.1–4 and the pan offsets are finite.

A save takes the same Postgres advisory lock as the other write paths ([AppLocks.cs](../../api_v2/Data/AppLocks.cs)), keyed per person, so two saves from the same account cannot interleave. Bad input gets the repo's plain 400 wording, never a raw 500.

## The page

- Route `scratchpad`, `canActivate: [adminGuard]`, lazy like the other pages, `data: { title: 'Scratchpad', lede: 'A board to think with your industries.', admin: true }` in [app.routes.ts](../../angular/src/app/app.routes.ts).
- Third tab in the admin nav in [app.html](../../angular/src/app/app.html) (the comment there is the placeholder): `Overview`, `Scratchpad`, `Settings`, then the bell, theme button and account pill. `ADMIN_PAGES` in [shortcuts.ts](../../angular/src/app/services/shortcuts.ts) gains the entry, so Previous / Next page step through three pages.
- New `Components/scratchpad/` (ts, html, css, spec) and `services/scratchpad.ts`.
- [app.spec.ts](../../angular/src/app/app.spec.ts) changes its admin-tab assertion to `['Overview', 'Scratchpad', 'Settings']`.

### Board state and undo

`services/scratchpad.ts` owns:

- the current `Document`, as a signal;
- the **history**: an array of document snapshots and an index, capped at 100 (the oldest is dropped);
- a change is committed to history **once**, not per event: on pointer-up for a move, after a typing burst goes quiet (or the note loses focus) for text, and immediately for add and delete. `Ctrl+Z` while a note has focus undoes that note's last burst, and the page stops the browser's own textarea undo from fighting it;
- the view (pan and zoom) lives outside the history, so undo never moves the camera;
- the **save status**: `idle`, `saving`, `saved`, `error`.

### Saving

Every committed change and every view change starts a **700 ms** debounce, then `PUT /scratchpad` with the whole document. No Save button.

- On success the page shows `Saved to your account` for a moment.
- On failure the changes stay in memory and are retried quietly; only after the retries keep failing does the page show `Couldn't save. Your changes are kept on this page.` with **Try again**.
- If the first `GET` fails, the page shows a plain message and **Try again** instead of opening an empty board, so an empty canvas can never overwrite a real one.

### The canvas

- The board fills the page under the nav. One transformed layer: `translate(panX, panY) scale(zoom)`, origin top left. Screen↔world conversion is one helper used by every interaction.
- **Pan**: two-finger scroll, `Space` + drag, or the Hand tool. Holding `Space` shows the grab cursor and stops the page scrolling.
- **Zoom**: `Ctrl`/`Cmd` + scroll, or a trackpad pinch, **toward the pointer**, so the spot under the cursor stays put. The wheel listener is attached in code with `{ passive: false }` so the browser is stopped from zooming the page; outside the canvas the browser keeps it. Zoom is clamped 10%–400%.
- **Fit**, **100%** and **Selection** buttons, and `Ctrl+1`, `Ctrl+0`, `Ctrl+2`.
- New things appear in the **nearest free spot** in view, never on top of something else.

### Adding and editing

- A small left column lists industries with an **add** button and a drag handle, matching the design's "Drag a company from the list". It reads the same full list Browse and Overview already load (`IndustryApi.getAll()`), ordered by name, shows the first 50 under a search box, and refreshes cards from that list when it arrives. A full table of 100k rows is the same load those pages already carry; if it ever becomes slow that is its own slice. Dropping on the board places the card where it was let go; the button places it in free space. This is the one drag path in slice a.
- Sticky notes and text boxes are added from the toolbar or by `N` and `T`.
- A note or text box is edited in place with a plain `textarea` styled to look like paper. Rich text (bold, highlight, fonts) is slice `d`; slice a stores plain `text`.
- Clicking selects one thing; the selected thing gets the orange outline and a small bar with **Delete** and a paper colour for notes. `Esc` clears the selection. Notes and text boxes show a resize-free fixed width per type.

### Keyboard

`Scope` gains `'scratchpad'`, and the slice registers: `sp.select` (V), `sp.hand` (H), `sp.sticky` (N), `sp.text` (T), `sp.undo` (Ctrl+Z), `sp.redo` (Ctrl+Y), `sp.zoom100` (Ctrl+0), `sp.fit` (Ctrl+1), `sp.zoomSel` (Ctrl+2), `sp.clear` (Esc). The one listener in the service already skips plain keys while someone is typing and lets `Ctrl` combinations through, which is what makes undo work inside a note.

Two keys are **not** commands, because [shortcuts.ts](../../angular/src/app/services/shortcuts.ts) lists them as browser-reserved: `Space` (pan) and `Delete` (remove the selected thing). The Scratchpad handles those two directly on the document, only when focus is not in a text box. Slice `g` is where the panel and the reserved list get their proper scope-aware treatment.

Rebinding still lives in browser storage for now; moving keys per person to the server is slice `g`.

### Look and the states the page must cover

- Colours only from the CSS variables in [styles.css](../../angular/src/styles.css). The board uses the admin layout's light and dark sets that already exist; the one signal colour means "selected" and nothing else.
- States: **loading** (skeleton), **empty board** (the "add a note, drag a company" hint), **failed to open** (plain words, Try again), **saving / saved / couldn't save**, and **one item selected**.
- Dark mode and 390 px are checked before this is called done, including the focus ring.
- Plain words everywhere. No jargon, and nothing says "admin".

## Migration

1. Add `Model/ScratchBoard.cs` and the `AppDbContext` wiring.
2. Run `.\migrate.ps1 -Name AddScratchBoards` in `api_v2`.
3. **Show the generated migration to the user before applying or committing it**, as the repo's migration rule requires.
4. Restart the API, which applies it on startup.

No change is made to the `Industries` table, so the restore and history paths are untouched.

## Checks

| What | How |
|---|---|
| Board reducer: add, move, delete, undo, redo, cap | Vitest over `services/scratchpad.ts` |
| Free-spot placement never overlaps | Vitest |
| Zoom clamp and zoom-toward-pointer maths | Vitest |
| Save status: debounce, saved, retry, error | Vitest with `provideHttpClientTesting` |
| Page: renders cards and notes, add a note, undo removes it, first open saves | `Components/scratchpad/scratchpad.spec.ts` |
| Shortcuts: the scratchpad scope is registered and the keys are bound; `app.spec.ts` tab list | Vitest |
| Build | `ng build` clean, initial total under 500 kB |
| API | `dotnet build` 0 warnings; GET/PUT/DELETE round-trip against the local API; bad payloads refused with plain 400s; the size and item caps enforced |
| Browser | `npx ng serve` + API: pan, zoom, fit, selection zoom, add, move, edit, delete, undo/redo, reload keeps the board and the view, 1366 and 390, light and dark, console clean |

## Risks and things decided here, so they are not surprises

- **Text undo is per burst.** `Ctrl+Z` inside a note takes back the last burst of typing, not one letter. Replacing the browser's own textarea undo is deliberate, because the brief wants one undo for moves, deletes, drawings and typing.
- **`h` is an estimate.** Placement uses a stored height that the page updates after it draws; a note that grows a lot can nudge a neighbour on the next new item, never move one.
- **Pinch on touch is best effort.** It is written with pointer events and checked with synthetic events; a real phone may still need a pass later.
- **Two tabs.** The optional `updatedAt` guard stops one tab quietly overwriting the other; without it the last save wins.
- **Local `main` is 17 commits ahead of `origin/main`.** The branch is off local `main`. Pushing and the PR come later, when asked.

## What comes after slice a

`b` (select several), then `d` (bold and highlight), then `c`, `f`, `g`, and `e` last, once the file storage question (the placeholder 25 MB, the upload endpoint and its table) is answered. Each gets its own spec, and the ones that touch the model still need the user's yes first.
