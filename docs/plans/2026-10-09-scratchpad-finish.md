# Scratchpad: finishing the design

**Done 2026-10-10** on `scratchpad-canvas`, together with named boards and the History tab. Every item below is built; what changed from this plan, and what was checked, is in "Update 2026-10-10" at the end of `OVERVIEW_HANDOFF.md`.

Written 2026-10-09 on `scratchpad-canvas`. The parts of `design/Scratchpad-Light.dc.html` and the Scratchpad sections of `OVERVIEW_HANDOFF.md` that are still missing after `6482656` and the uncommitted design round (files, bars, papers, fonts, carry tray, Mouse rows). Scratchpad only; the Overview audit is a later round.

## The user's decisions (2026-10-09)

- Shortcuts, the mouse keys and the theme are saved **per person on the server**. The model and migration are shown to the user (Up, Down, SQL) and rehearsed on the throwaway database before they touch the real one.
- **Pen, marker and rectangle** tools are built.
- Scratchpad only this round.

## How the work is judged

1. Before any code, an Opus critic reads this plan and writes `testing/rubric.txt`: what it will check and how it scores out of 10.
2. The work is built, then stress tested (by me, and by the critic if it wants).
3. The critic gets the rubric back and grades the real running app harshly. If the grade is too low the work loops: fix, stress test, grade again. At most three loops. The critic is never told what grade passes.

## What gets built

### 1. Edit keys (item g)

All in the Scratchpad scope, rebindable in the Shortcuts panel, each one undo step, none firing while typing in a note or a box (Ctrl combinations included where the note needs them: Ctrl+A in a note selects its text).

| Function | Default | Notes |
|---|---|---|
| Group | Ctrl+G | Needs two or more picked. Takes Ctrl+G from the browser (find next) on the Scratchpad only |
| Ungroup | Ctrl+Shift+G | On a picked group |
| Duplicate | Ctrl+D | Copies of the picked things land beside them, in free space, lines between copied things are copied too. Takes Ctrl+D (bookmark) on the Scratchpad only |
| Select all | Ctrl+A | `Ctrl+A` is on the panel's browser-reserved list; the Scratchpad scope is exempt from that refusal and the panel says why |
| Nudge | Arrow keys 1px, Shift + arrow 10px | Moves what is picked; a burst of presses is one undo step |
| Send back / bring forward | Ctrl+[ and Ctrl+] | The brief says `[` and `]`, but those already belong to the global Previous / Next page keys, and the panel never lets two functions share a key. Ctrl+ keeps both working. The z order is the order of `items` |

### 2. Duplicate while dragging

The Mouse group's fourth changeable row: "Duplicate while dragging: Alt + drag". The copies move and the originals stay; one undo step. Its held key can be Shift, Ctrl or Alt like the others, and two rows never share one.

### 3. Resizing notes and text boxes

A grip in the bottom right corner of a note or a text box. Drag to resize, with a minimum size, one undo step, lines stay glued to the new edge, the group outline follows.

### 4. Lines from the keyboard

A line can be reached with Tab, picked with Enter or Space, removed with Delete. A visible focus ring on the line.

### 5. Pen, marker and rectangle

- Tools in the toolbar beside Select, Hand and Line, with keys P, M and R (rebindable), and the toolbar hint says what each does.
- Pen: a thin ink stroke. Marker: a wide see-through stroke in the signal colour. Rectangle: drag to draw a box, with a paper colour.
- Stored on the board as new item types (`stroke` with points, `rect`); the API's board check learns them, with limits on the number of points so a board can't grow without end.
- Strokes and rectangles can be picked, moved, deleted, grouped, duplicated and undone like everything else. Esc goes back to Select.

### 6. The carry tray on every admin page

The tray moves out of the Scratchpad page into the app shell, along the bottom of every admin page (Overview, Scratchpad, Settings). On the Overview the circle card and the list card can be dragged onto the tray, as well as the Carry buttons. On the Scratchpad a chip still drags onto the board.

### 7. Video

A video file card plays in place (`<video controls>`, fetched with the sign in like a picture preview). GIFs already preview as pictures.

### 8. File sweep

A background job removes uploaded Scratchpad files that no board refers to any more, after a grace period (7 days from upload), row and disk file together. A file still on the person's board is never removed.

### 9. Per person on the server

- New table `UserSettings`: `UserId` (PK, FK to `Users`, cascade delete), `Shortcuts` (jsonb, only the keys changed from the defaults), `Mouse` (jsonb), `Theme` (`light`, `dark` or null for the system setting), `UpdatedAt`.
- `GET /me/settings` and `PUT /me/settings` for the person signed in, with the same checks the page makes (known command ids, at most two keys each, known modifiers, known theme).
- The page loads them on sign in and saves on change. What is in browser storage from before is carried up once, the first time. Signed out, browser storage is still used.
- **The migration is shown to the user before it is applied.**

## Done means

- `ng test`, `ng build` (initial under 500 kB) and `dotnet build -c Release` with 0 warnings.
- A check script in `testing/` for the API side (settings round trip and its refusals, the new board item types and their limits, the sweep).
- The real page in a browser: every item above, light and dark, 1366 and 390 wide, no sideways scroll, no page errors.
- A stress test: many items, long strokes, key bursts, two tabs, the API slowed down or down.
- The critic's grade.
