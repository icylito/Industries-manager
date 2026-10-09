# Handoff: "Open in Browse" for the admin Overview

Written 2026-10-07 by Claude (Sonnet 5.5) during a design session. For Opus, who builds the Browse side. **Nothing in this file is built yet.** No app code was changed in the design session.

## What this is for

The admin Overview (a new page, design only so far) shows charts of the table. When the admin filters it down, a button says **"Open 124 in Browse"**. It must open the Browse page showing exactly those rows, so the admin can edit, delete or export them. The Overview is for spotting, Browse is for acting.

The design lives on a canvas artboard (private artifact): https://claude.ai/artifact/HjAzUY9spw4zfnZ9TDXgY5 . Boards that matter: `C-Signal-Light` (the Overview) and `Scratchpad-Light`. Ask the user to open it if you need to see the button and the filter chips.

## The problem

Browse (`angular/src/app/Components/my-components/my-components.ts`) has four filters and reads nothing from the URL:

| Browse today | Where |
|---|---|
| search (name contains) | `search` signal |
| sector (exact match) | `sectorFilter` signal |
| min price, max price (inclusive, rows with no price are excluded) | `minPrice`, `maxPrice` signals |

The Overview filters on more than that. If the button promised "124 rows" and Browse ignored a filter, the count would be wrong. That is the thing to avoid.

## What the Overview can filter on, and what Browse needs

| Overview filter | Meaning | Browse has it? | Needs |
|---|---|---|---|
| Sector (slice) | `sector` equals a value | Yes | read it from the URL |
| Price band (slice) | 0 to 2.5, 2.5 to 5, 5 to 7.5, 7.5 to 10 | Yes, as min and max | read both from the URL, see the boundary note below |
| Release period (bar) | 5 year periods, 1995 to 1999 up to 2025 to 2026 | **No** | a release date range filter: `releaseFrom`, `releaseTo` |
| Release era (slice) | 1990s, 2000s, 2010s, 2020s | **No** | same date range filter |
| Needs attention: **Similar row** | `duplicateOf !== null` | **No** | a flag filter |
| Needs attention: **Lost fields** | `lostFields` is not empty | **No** | a flag filter |
| Needs attention: **No price** | `price === null` | **No** | a flag filter |
| Needs attention: **No release date** | `release === null` | **No** | a flag filter |

The Overview calls the first chip "Possible duplicates". Browse's own wording is "A similar row exists" (see `item.duplicateOf` around line 574). Use Browse's wording on the page, or tell the user you changed one of them.

## Suggested URL contract

Keep it flat and readable, one param per filter. Names are a suggestion, change them if something in the router fits better.

```
/?sector=Public%20Sector
/?minPrice=2.5&maxPrice=5
/?releaseFrom=2010-01-01&releaseTo=2014-12-31
/?flags=duplicate,lost,noprice,nodate        (several allowed, see below)
/?q=nizwa
```

- Browse should read these when the page opens, put them in the existing signals, and show the active filters the way it already does. `hasFilters()` and `clearFilters()` must cover the new filters too.
- Typing in the filters should keep working as it does today. The URL only seeds the filters. Writing them back into the URL is optional.
- A sector or flag value Browse doesn't know should be ignored, not crash.

## Rules that must hold

1. **Several flags combine as OR.** The Overview's Needs attention chips are multi select. A row passes if it has **any** of the chosen flags. Every other filter (sector, price, date) combines with AND, and the flag group counts as one AND term. Example: sector=Private and flags=duplicate,lost means private rows that are a similar row or have lost fields.
2. **Price band boundaries.** The Overview puts a price of exactly 2.5 in the band 2.5 to 5, not 0 to 2.5 (it uses `floor(price / 2.5)`). Browse's max is inclusive. So band 0 to 2.5 as `maxPrice=2.5` would include 2.500 and the count would be one off. Either send `maxPrice=2.499` (prices have 3 decimals), or add an exclusive upper bound. The last band (7.5 to 10) is inclusive of 10.
3. **Release period boundaries** are whole calendar years: 1995-01-01 to 1999-12-31, and so on. The last period is 2025 to 2026 (two years).
4. **Rows with no price or no release date** never match a price or date range. That matches the Overview, which leaves them out of the bars.
5. **The count must match.** After the change, "Open N in Browse" should show N rows when Browse opens. If some future Overview filter can't be mapped, hide the button, don't show a wrong N.

## Where to be careful

- The user's rule: **flag any large TS change before making it**, keep their CRUD logic intact, and keep Windows line endings (CRLF) in `angular/src`.
- Colours only from the CSS variables in `angular/src/styles.css`. If you add filter UI to Browse, reuse the existing filter styles in `my-components.css`.
- Plain words on the page. The people using it are not developers.
- The Browse page must still work with no URL params at all.
- No backend change is needed for this part. The filters can run on the loaded list like the existing ones do (`filtered` computed). Don't add API endpoints for it.
- Commits only when the user asks. One plain lowercase line, then `Contributor: coder bot opus 5.5`. No co-author line.

## Rest of the Overview, for context (not part of this task)

- New route `/overview`, behind `adminGuard`. First tab in a slim nav: brand, Overview, Scratchpad, and the admin pill. The old crowded nav links are dropped from the design.
- Charts are hand built SVG and CSS, no chart library. One `selection` state drives everything.
- **The circle and the release period bars are one connected card (decided 2026-10-07).** One bordered card, circle on the left, bars on the right, a thin divider between them (a thin line across on a phone). The point: the two charts answer one question together, "how many industries, split how, and when did they come out".
  - **With Count and no slice picked, every bar is stacked from the circle's slices**, in the same shades as the circle (black, then greys), with a small legend under the bars (name and count per slice). Industries that have no value for the current split show as a light grey top piece so the bar still adds up to the total.
  - **Hovering a slice** (on the circle, in the legend, or in the Breakdown list) turns that slice orange everywhere: the circle, the legend and its piece in every bar, and dims the rest. This is what makes "the smaller bits" feel connected.
  - **Clicking a slice** is the "specific bar chart": the bars show only that slice in orange, with the total as a faint grey ghost behind each bar. The legend and the circle show it picked. Clicking it again goes back to the stacked view.
  - **Average price cannot be stacked** (averages do not add up), so in that mode the bars are single bars as before and a footnote says to pick a slice to see its own bars. Compare mode keeps its own paired bars.
  - Clicking a bar still filters by release period. A bar tooltip names the hovered slice's count when a slice is hovered.
- Decided in the design session: the Needs attention chips are multi select (any of them). "Find a company" shows that row's details and rank. It does not highlight anything in the charts, because a bar holds about 40 companies and the highlight told you little.
- The Scratchpad (drag companies, sticky notes, text boxes, glued lines, pen and marker) is saved **per person on the server**. That needs a new table and a migration, so confirm with the user before touching the model, as `model-change-needs-migration` says.
- **Decided 2026-10-07:** the page says **"industries"**, never "stocks" or "listings". Prices show with a **`$`** (Browse's own stat card uses a dollar sign), 3 decimals for single prices, 2 for averages.
- **Slice by custom fields.** The "Slice by" list is built from the rules (`GET /schema`): Sector, Price band and Release era are built in, and every **text field that has a list of options** is added with a small CUSTOM tag. The design shows two example fields, Region and Stage. If a field has more than 4 options, group the tail into one "Other" slice, the pie draws at most 4 slices plus legend rows. Number keys 1 to 5 switch what the pie is split by.
- **States the page must cover** (all designed on the `C-Signal-Light` board, switch them with the dashed Prototype bar at the top): loading (grey skeleton blocks), empty table (explains and links to Add and History), failed to load (plain words, "Try again", technical details hidden behind a link), out of date (banner with "Refresh now", the old numbers stay visible), only one sector, and very few rows. Filters that match nothing show a "No industries match these filters together" note with Clear all. The Open in Browse button hides in that case.
- **Phone width.** The prototype bar has a Phone switch. It only approximates a phone: in the real app use CSS media queries. What changes on a phone: the nav shrinks to icons, the Shortcuts button is hidden (no keyboard), the circle card goes full width, and the Top 3 rows drop their price bar.
- **Keyboard.** `1` to `5` switch what the circle is split by, `Esc` clears every filter. **Arrow keys step through the options** of the "Slice by" list and the "Breakdown" list once one of its buttons has focus: the focus ring and the choice move together, it wraps at the ends, and the page must not scroll while you are inside the list (call `preventDefault`). In Compare mode the arrows only move focus, because picking two slices is a deliberate click. An earlier version moved the choice without moving the focus ring, which was confusing, and without the `preventDefault` the arrows just scrolled the page. Tab and Enter work on the real buttons as usual.
- **Customisable shortcuts (VS Code style).** The Shortcuts button opens a "Keyboard Shortcuts" panel, designed on `C-Signal-Light`. Build it like this:
  - **Commands are data.** One list of `{ id, label, scope: global | overview | scratchpad, default keys }`. The Overview and the Scratchpad both read it, so one panel edits both pages. Default keys: `G` then `O` and `G` then `S` (go to Overview or Scratchpad), `[` and `]` (previous and next admin page), `?` (open the panel), `1` to `5` (split the circle), `/` (find an industry), `C` (compare), `M` (Count or Average price), `T` (cycle Top 3, Top 10, Cheapest 3), `Esc` (clear filters). Scratchpad: `V` `L` `P` `M` tools, `N` new sticky, `T` new text box, `Ctrl+Z`, `Ctrl+Y`.
  - **A binding is one key combination or a sequence of two** (like `G` then `K`, 1.2 seconds to press the second). Single plain keys never fire while the person is typing in a text box or note. Combinations with Ctrl, Alt or Cmd do.
  - **The panel (kept deliberately simple, the user asked for it, 2026-10-07):** it opens centred on the screen and the app behind it steps aside: over about 300ms the app scales to about 0.95, slides slightly to the left and fades from 100% to 60% opacity, so the panel sits clean in the middle. On close the app goes back to full size and opacity. **Esc, the close button and a click outside all close it.** The toast must stay above the dimmed app, not dimmed with it. It holds one search box (finds by function name, by what it does, or by the key), one **Reset** button (puts every key back to its default), and a plain list with three columns: **Function**, **What it does**, **Key** (keycap chips). Nothing else: no filter chips, no When or Source columns, no footer, no per-row reset or remove buttons. **The key itself is the button**: people click the key chips in the Key column (they get a border on hover) to change it, not a pencil and not the function name. The function name is plain text. After the click a box says "Press the new key". **Changes apply the moment the key is pressed: there is no Enter, no Save button, nothing to confirm.** A small toast says what changed ("Compare now uses X"). Only two things stop it: a key the browser keeps for itself (plain sentence, nothing changes) and a key another function already uses (a one-line warning with Take it over or Cancel, because silently stealing a key would surprise people). Esc cancels the key box. **Reset** puts every key back to its default, also at once, no "are you sure". While the panel is open it owns the keyboard. Keep it this plain. Rebinding records one key or one combination (Alt+1), not a two key sequence like G then O, to keep instant saving unambiguous; the defaults can still be sequences. Persist every change to the server as it happens (debounce is fine).
  - **Checks while recording.** Keys the browser keeps (Ctrl+T, Ctrl+W, Ctrl+Tab, Alt+Left, F5, Ctrl+C and the like, plus Tab, Enter, Space, Backspace, Delete) are refused with a plain sentence and nothing changes. A key already used by another function in an overlapping scope shows who has it, with two buttons: **Take it over** and **Cancel**. Overlap means the same scope, or either side being "Any admin page". A single key also clashes with a sequence that starts with it.
  - **Take it over really takes the key.** The new function gets the key and the other function is left with **no key at all** ("Click to set a key"), so it can no longer be run from the keyboard until the person gives it a new key or presses Reset. A key therefore never belongs to two functions, and there is no conflict state to show later and no tie break to explain. The toast says it in one line: "Previous page now uses ]. Next page has no key now."
  - **Cancel** changes nothing and closes the key box.
  - There was a third button, "Apply anyway" (keep the key on both functions), and the user decided against it on 2026-10-07. Do not build it. If someone asks for it again, the reason it was dropped is that two functions on one key needs a "which one runs" rule that people would have to learn.
  - **Saved views are the macros. The panel no longer has a button to make one (removed to keep it simple), so decide with the user where "save this view" lives, for example next to the filter chips.** The prototype still holds a saved view and the engine for it. The idea: "Save current view as a shortcut" stores the current filters (split by, slice, release period, attention chips, bars metric), names it from them (for example "Sector: Private Sector, Similar row") and opens the key box straight away. Pressing its key re-applies every filter at once. Deleting the view deletes its key. The same saved view can feed the "Open in Browse" link later.
  - **Storage: per person on the server**, next to the scratchpad. That is a new table and a migration, so **confirm with the user first**. Store only what differs from the defaults (command id to keys) and the saved views. Browser storage is fine as a first step.
  - **Listening.** The design can't attach a document level listener, so it keeps focus on the page area. In Angular use one `@HostListener('document:keydown')` in a small shortcuts service.
  - **Not designed yet:** renaming a saved view, exporting or importing shortcuts, and the Scratchpad reading the customised keys (the prototype's Scratchpad board still uses its built-in keys).
- **Icons use `currentColor`** so they always match their text colour (black text, black icon; orange, orange; white, white).
- **The two "Edit in Browse" links and the "Open N in Browse" link are dead in the design on purpose.** Each has an `OPUS:` comment in the design file.
- **Who can see the Overview and the Scratchpad: admins only for now** (decided 2026-10-07, "maybe in the future we expand it"). Keep both behind `adminGuard`. Build the access check in one place so widening it later is a one line change, and do not hard code "admin" into the page text.
- **Storage approved (2026-10-07).** The user said yes to server storage for: the Scratchpad boards (per person), the shortcut changes and saved views (per person), the light or dark choice (per person), and, when item e is built, uploaded files for the Scratchpad. That covers new tables and the migrations they need, following `model-change-needs-migration` (show the user the model change and the migration before running it, as that rule says). Files: size limit, a plain error for too big, and Word, PowerPoint and Excel files refused with the message in item e. Tell the user if the scope you are building is wider than what is listed here.

## Intent, not instructions (added 2026-10-07)

The user's call: **explain the intent, don't build the logic.** The board code (the shortcut engine, the undo history, the glued lines, the drag code) is a sketch to show how it should feel. Opus is free to rewrite all of it, in Angular terms, as long as the behaviour and the feel below survive. Where the board and this section disagree, this section wins.

### Scratchpad: what it is for

A place to **think with your industries**. An admin pulls a few industries onto a board, puts notes around them, draws arrows between the ones that belong together, and comes back tomorrow to find it as they left it. It is not a report and not a database view. It should feel like a table with paper on it, quick and forgiving, with nothing to learn.

Feel to keep:
- **Ctrl+Z is essential** (the user's words, 2026-10-07). Nothing asks "are you sure" because every action can be undone with Ctrl+Z (Cmd+Z on Mac) and redone with Ctrl+Y or Ctrl+Shift+Z, including deletes, moves, drawings and typing, and also while a note has focus. Do not ship the Scratchpad without it. The board has `OPUS:` comments at the undo code.
- A line that is glued to two cards stays glued when either card moves. The person never thinks about it.
- New things appear in free space, never on top of something else.
- The toolbar never jumps around. When nothing is selected it says what to do, in the same spot.
- Saved per person, automatically, no Save button. A small "Saved" note is enough.

### Scratchpad: what the user asked for (2026-10-07)

Each item says what it is for, how it should feel, and why it matters. Storage, wiring and algorithms are Opus's call. **Build order the user wants: a, b, d, then c, f, g, then e after the user confirms file storage.** Anything touching storage or the model (e, boards, per-person saving) needs the user's confirmation before anyone builds it.

**a) An endless canvas, like Figma or Paint.**
- For: one board that can hold a whole wall of things, so people stop worrying about running out of space.
- Feel: pan with Space + drag or two finger scroll, zoom with Ctrl + scroll or pinch. Zoom out and everything gets smaller, so the whole wall is visible. Panning and zooming are smooth and never lose the person's place. The board **remembers where the person left it** (position and zoom), so coming back tomorrow shows the same view.
- Keys: one to jump to 100%, one to fit everything on screen, one to zoom to the selection (defaults in g).
- Why: this replaces the earlier "several boards per person" idea. One endless board is simpler than a list of boards.
- Later, only if it is ever needed (not now): a small board name chip at the top left opens a list of previous boards with a "New board" button.

**b) Select several things at once.**
- For: moving, deleting and recolouring ten cards one at a time is the first thing that will annoy people.
- Feel: drag a box on the empty board to select everything it touches, or Shift + click to add or remove one. The selected things show one clear outline and move, delete or change colour together. Glued lines follow. Undo reverses the whole move in one step.

**c) Group under a label.**
- For: this is how a pile of cards becomes an idea ("Slow movers", "Check with Sara").
- Feel: select some cards, name the group, and it moves as one. A light outline and a label above it, nothing heavy. **No nesting and no folders.** Ungrouping gives the cards back exactly where they are.

**d) Bold and highlight on any selected text.**
- For: people expect to select a few words, even across several lines, and make them bold or highlighted. The board only formats whole paragraphs today.
- Feel: a small toolbar floats just above the selection and disappears when nothing is selected. It never covers the selected words.
- Store the formatting as **text spans** (a range of text plus its style), not as a setting on the whole paragraph.

**e) Drag things in. Needs the user's confirmation on file storage first.**
- Charts and cards from the Overview drag into the Scratchpad as a **frozen snapshot card**, labelled with what it showed ("Circle split by Sector, Private Sector selected"). Frozen means it does not change when the table changes. The two pages are separate pages, so add a **small carry tray along the bottom of every admin page**: drag something onto the tray on the Overview, go to the Scratchpad, drag it off the tray onto the board.
- Drop files from the computer: images, GIFs, video, PDF, anything **except Word, PowerPoint and Excel**. Those get a plain message: "Word, PowerPoint and Excel files can't go on the board." Ctrl+V pastes an image straight onto the board.
- Files live on the server. That needs a size limit, an upload endpoint and a new table, so **confirm with the user before building any of it.**
- Feel: dropping something is instant, it shows up where the person let go, and Ctrl+Z removes it.

**f) Better lines.** Build in this order: a **label on the line** ("depends on"), an **arrowhead**, then a **gentle curve** last so lines do not cut through cards. For: the lines are the thinking, they should be able to say something. Lines stay glued to both cards.

**g) Customised controls on the Scratchpad.**
- The Scratchpad is mostly mouse, so the shortcuts panel gets a **"Scratchpad canvas"** scope and a **"Mouse"** group, in the same plain list (Function, What it does, Key).
- **The Scratchpad must read the customised keys**, so one panel edits both pages. Today the Scratchpad board ignores them.
- Tool keys, all rebindable: V select, H hand, L line, P pen, M marker, N sticky, T text, R rectangle.
- View keys: Ctrl+0 zoom to 100%, Ctrl+1 fit all, Ctrl+2 zoom to selection, hold Space to pan.
- Edit keys: Ctrl+D duplicate, Ctrl+G group, Ctrl+Shift+G ungroup, Ctrl+A select all, Delete, arrow keys nudge 1px (10px with Shift), [ and ] send back and bring forward. Plus Ctrl+Z and Ctrl+Y (essential, see above).
- Mouse rows in the same table, shown as plain text: "Pan: Space + drag", "Zoom: Ctrl + scroll", "Add to selection: Shift + click", "Duplicate while dragging: Alt + drag". **A mouse gesture cannot be recorded**, so only the modifier key in each row can be changed (for example Shift or Alt), not the mouse action.
- **Ctrl + scroll also zooms the browser.** Inside the canvas the page must take it over (preventDefault on the wheel event, a non passive listener) so only the board zooms. Outside the canvas the browser keeps it.
- Ctrl+0, Ctrl+1 and Ctrl+2 are browser shortcuts too (reset zoom, tab 1, tab 2). Inside the canvas take them over for the board. Note for the shortcuts panel: the "browser keeps this key" refusal list must not refuse these when the Scratchpad canvas scope is the one being edited, or must at least say why.

**What the Scratchpad board already shows (built 2026-10-07, for a, b, d and the easy part of g), and the shortcuts the prototype takes.** The user said it is fine for the board to take shortcuts on the logic as long as it is explained here, because the work is mostly frontend. **No new keys were added**: only the keys that were already in the shortcuts list (V, L, P, M, N, T, Ctrl+Z, Ctrl+Y, plus Esc and Delete). Everything below is new behaviour on the board, the right column says what Opus should do properly.

| Thing | What the board does | What Opus should do |
|---|---|---|
| **a) Pan and zoom** | The board has no edge. Scrolling with two fingers pans. Ctrl + scroll or a trackpad pinch zooms toward the cursor, from 10% to 400%. A **Hand** button (no key) drags the view. **Fit** shows everything, **Selection** zooms to the selected things, the percentage resets to 100%. The last view (position and zoom) is remembered in the browser. | Make the canvas fill the page, and keep position and zoom per person on the server. The wheel handler must be a non passive listener so it can stop the browser zooming the page (the board does this by attaching it in code). Smooth the zoom. Keys for 100%, fit and zoom to selection are **not added yet** (the user said no new keys), so Hand, Fit and Selection are buttons only. |
| **b) Select several** | Drag a box on empty space (select tool) to select every card or note it touches. Shift + click adds or removes one. A bar says "N things selected" and offers paper colours (applied to the selected sticky notes) and **Delete all**. Dragging any selected thing moves all of them, one undo step. Esc or clicking empty space clears. | Same behaviour. Lines between selected things should follow. Group is built, see round two below. Panning with a plain drag on empty space was replaced by the box, so people pan by scrolling or with the Hand tool. |
| **d) Bold and highlight on selected words** | Text is stored as **runs** (`{ text, bold, highlight }` pieces), not as a paragraph setting. Select words in a note and a small dark toolbar (B, Highlight) floats above that paragraph. Pressing it toggles the format on exactly those characters. Typing keeps the formatting of what was already there and new characters take the format of the character before them. The two buttons in the top toolbar do the same, on the selected words, or on the whole note when nothing is selected. Undo works. | Use one proper rich text editor for the whole note (for example a contenteditable with a small schema). **Known limit of the board: a selection cannot cross paragraphs, because each paragraph is its own text box.** That is the main reason to switch. The board draws the text twice (a styled copy underneath and a see through text box on top) and fakes bold with a thin outline so the letters do not change width, do not copy that. Position the floating toolbar over the actual selection, not the paragraph. |
| **g) Shortcuts panel on the Scratchpad** | The same panel (search, Reset, click a key to change it) is on this page. It lists the Scratchpad keys first, then the shared ones, then the Overview ones, then four **Mouse** rows (Select several, Add to selection, Zoom, Move around) that are plain text. The Scratchpad reads the changed keys: rebind Select tool to X and X selects, V does nothing. **N and T now work** (new sticky note, new text box), they were listed before but not wired. The changes are shared with the Overview board through browser storage. | Per person on the server (approved). One shortcuts service for both pages, listening on the document. The mouse rows should let the person change only the modifier key (Shift, Ctrl, Alt), not the gesture, as written in g above. Ctrl + 0, 1, 2 for zoom are still **not added**. |

**Round two (built 2026-10-07): c, f, e as screens, fonts, save status.** The user's instruction for this round: *make the UI and explain the logic, no need to wire the logic.* So everything below is drawn and clickable, and works in the browser tab, but it is a sketch of the behaviour. The right column says what to build properly. Nothing here added a key: groups, lines, files and fonts are all buttons.

| Thing | What the board shows | What Opus should do |
|---|---|---|
| **c) Group under a name** | Select several things (box or Shift + click), press **Group under a name** in the bar. The name box is focused with its text selected, type to name it. A dashed outline hugs the members with a name chip above it; the chip is also the handle: drag it and everything moves. Clicking any card in a group picks the whole group (orange outline, **GROUP** bar with Name, Ungroup, Delete group and cards). Ungroup leaves the cards where they are and selected. Delete removes the group and its cards (undo brings them back). A group with fewer than two things left stops existing. An item is in at most one group, so grouping a grouped card takes it out of the old one. **No nesting.** | A group is only `{ id, name, itemIds }`. Draw the outline from the members' real boxes on every draw (it grows and shrinks as they move). Keep it in the same undo history as everything else. Ctrl+G and Ctrl+Shift+G are the keys planned in g, not added yet. Box select does not pull in the rest of a group; decide if it should. |
| **f) Lines: label, arrowheads, curve** | Select a line, the **LINE** bar has: Label (type, shows on the line as a small pill), arrowhead None / One end / Both ends, shape Straight / Curved, Flip curve. A new line starts selected with its label box focused, so you can name it straight away. Lines are drawn as one SVG layer; the label pills sit above the cards. Lines meet the **real** edge of each card (the board reads each card's height after drawing). Lines can be selected with the keyboard (Tab to the line, Enter), written but not tested. | A line is `{ from, to, label, head: none/end/both, bend }`. The curve here bends a fixed side by a fixed amount and the person can flip it. **Intent: curves exist so lines do not cut through other cards.** Pick the side that crosses fewer cards. Keep the glue (move a card, the line follows). The label should be editable on the line itself (double click) as well as in the bar. |
| **e) Carry tray** | Under the board on the Scratchpad and at the bottom of the Overview: **CARRY TRAY** with chips. On the Overview, **Carry the circle** and **Carry the list** (next to Shortcuts) put what is on screen, with its filters, into the tray. On the Scratchpad each chip has **+** (put on board) and **×**, and can be dragged onto the board. It becomes a **Snapshot** card: SNAPSHOT label, a Frozen badge, the title ("Circle split by Sector, Private Sector selected"), a small circle with legend or a short list, and "From the Overview, 7 Oct, 14:02". The bar has "Open in Overview" (dead link on purpose, `OPUS:` comment). | A snapshot is `{ kind, title, takenAt, numbers }`: the title the person would read, the numbers as they were, never recalculated. The tray is a small per person list kept on the server and shown along the **bottom of every admin page** (the board only puts it under the board and at the end of the Overview, and shares it through browser storage). Dragging a chart onto the tray (the intent in e) is not drawn, the Carry buttons are the accessible way in; do both. "Open in Overview" should restore the same slice and selection. |
| **e) Files and pictures** | **+ File or image** in the left column, or drop a file on the board, or paste a picture. While a file is being dragged over the page, the + File or image field turns into a dashed orange drop target saying **Drop files here**, and **Release to add it** when the file is over it. Over the board the whole board gets an orange overlay, "Drop to put it on the board". Each file becomes a card at the drop point (or in free space): a picture shows its preview, anything else shows a file icon with its type, name, size and an upload bar. Word, PowerPoint and Excel files show a dark message on the board: "Word, PowerPoint and Excel files can't go on the board", and files over **25 MB** get "is bigger than 25 MB". A failed upload shows "Couldn't upload" and **Try again**. Dropping outside any target does nothing (the browser must not open the file). The FILE bar has Open (dead link, `OPUS:` comment) and Remove from board. | The user approved server storage. Needs: an upload endpoint, a size limit (**25 MB is a placeholder, the user has not chosen it**), a table, and a migration (see `model-change-needs-migration`; confirm the field names with the user). The card keeps the file's id, never a browser address. Decide the allow list: the user said everything except Word, PowerPoint and Excel, but think about executables and SVG (the board refuses to preview SVG because it can carry script). Video and GIF: the board shows a plain card, a player is yours. Ctrl+Z removes the card (the file can be cleaned up later). |
| **Fonts** | Select a note and the TEXT bar has a font button showing the current font in its own face. It opens a list of **27 Google fonts**, grouped Sans serif, Serif, Monospace, Display, Handwriting, each name drawn in its own typeface. Picking one changes the note straight away and the list stays open to try more; pressing anywhere outside closes it. | The board keeps **one font per note**, because the text is drawn twice (a styled copy under a see through text box) and two fonts would not line up. With the real rich text editor the font belongs on the text span like bold and highlight, so one note can mix fonts. Load the fonts from Google Fonts only for the fonts in use, not all 27 on every page (the board loads all of them so the list can show them). Same list: Inter, Poppins, Montserrat, Work Sans, DM Sans, Nunito, Lato, Open Sans, Raleway, Playfair Display, Merriweather, Lora, Libre Baskerville, Cormorant Garamond, Source Serif 4, JetBrains Mono, IBM Plex Mono, Space Mono, Oswald, Bebas Neue, Abril Fatface, Lobster, Caveat, Pacifico, Shadows Into Light, Permanent Marker, Dancing Script, Indie Flower. The page font is Inter, that stays the default. |
| **Save status** | Next to Shortcuts: **Save** while changes are not yet saved, **Saved** only after the server confirmed them, and **Failed to save** with **Try again**. | See "Scratchpad: the save state" below. Both triggers are required — any change (debounced) and a periodic save every 2 minutes — and "Saved" is never shown before the server confirms. The board itself still resets on reload in the prototype, so "Saved" is only the look. |
| **Review controls** | A PROTOTYPE strip at the top of the Scratchpad (like the Overview's) with Width, Saving, Board, Tray, Dragging a file and sample-file buttons. | Review only, not part of the page. The sample file buttons exist because the design tool cannot drop real files; they take the same path a real file takes. |

### Scratchpad: the save state (sharpened 2026-10-08)

The pill next to Shortcuts tells the truth at all times. It has exactly three states, and one rule decides which.

- **Save** — there are changes the server has not confirmed. This is the honest default: nothing is called saved until it is. Shown on any change and while the first save attempt is in flight.
- **Saved** — the server confirmed the latest change. Only after a successful save that covers every change made so far. A change that arrives while a request is in flight puts the pill back to Save.
- **Failed to save** — an attempt returned an error. Keep the person's changes on the page, keep retrying quietly, and show this with a plain "Try again". A failure reads Failed to save straight away rather than Save, and a later success flips it to Saved. Never show Saved in this state.

Triggers, both required:

- Any change schedules a save, debounced (about 700 ms) so a typing burst becomes one request.
- A periodic save runs every 2 minutes. It sends only when there are unsaved changes, so a long, quiet session cannot drift unsaved.
- While the pill reads Save it can be pressed to save immediately, so nobody has to wait out a timer.

Rules that must hold:

- "Saved" is never shown speculatively, on a timer, or because a request was merely sent. It means the server accepted the latest change and answered with the new timestamp.
- The two-tab guard stays: a stale `updatedAt` is refused with 409 and the pill must not pretend it saved. Say the board was changed somewhere else and offer Reload.
- On failure the pill says "Failed to save", never "Saved", and the page keeps the changes rather than dropping or reloading over them.
- Plain words only: no "dirty", no "sync", no "pending". Colours come from the CSS variables, and the failed state uses the danger colour with a visible focus ring.

**Stress test plan — write these, do NOT run them in this session** (a later session, with the app and the throwaway API running):

1. Burst: type quickly for 10 seconds, then stop. Exactly one request after the debounce, and the pill ends at Saved.
2. Change during flight: start a save and change again before it answers. The pill returns to Save, a second request follows, and the final state is Saved.
3. Failure then recovery: make the endpoint return 500, change, wait. Failed to save with the changes still on screen; restore the endpoint, press Try again, expect Saved and no data loss.
4. Retry storm: fail the endpoint for 3 minutes. Retries back off, the page stays usable, and there is no console error flood.
5. Two tabs: change and save in tab A, then save in tab B with the stale timestamp. Expect 409, tab B showing "changed somewhere else" with Reload, and no silent overwrite.
6. The 2-minute timer: make no changes for 5 minutes and expect no requests at all; then change and wait out the timer and expect a timed save only when there are unsaved changes.
7. Reload mid-flight: change and reload before the request answers. Either the change is saved or the pill never claimed Saved — never "Saved" for text a reload loses.
8. Offline: take the API down mid-edit. The page stays usable, the pill moves to Failed to save, and once the API returns, a retry or Try again reaches Saved with every change intact.

### Scratchpad: rail and files (decided 2026-10-08)

The user settled the two open questions.

**The companies rail.** It shows the **3 most expensive** industries when it opens, with a **title or helper line that says so** ("Most expensive first."), so the three rows are never a mystery list. Typing in the search box replaces them with up to 10 name matches. The rail never loads the table. One small API addition carries it: `GET /industries/top?by=price&limit=3`, viewer-readable, skipping rows with no price, highest first, ties broken by name then id. A card added from this list carries a real rank (#1..#3) — its position in the list. A card added from a search result carries no rank. Never a global price position.

**Files (item e) — storage approved.** New table `ScratchFiles`: `Id` (int PK identity), `UserId` (int, FK to `Users`, cascade delete), `Name` (the original name, shown on the card, never used as a path), `ContentType`, `SizeBytes` (bigint), `StoredName` (a GUID plus extension — the only name used on disk), `CreatedAt`.

- Files live on disk in a configured folder (`Scratchpad:Files`, default `scratchpad-files/`, git ignored, outside the web root). The file on disk is `{guid}{ext}`.
- Endpoints, admin only: `POST /scratchpad/files` (multipart), `GET /scratchpad/files/{id}`, `DELETE /scratchpad/files/{id}`. Serving sends `X-Content-Type-Options: nosniff`; images and PDF render inline, everything else is an attachment, and **SVG is never previewed**.
- **25 MB** cap, refused with a plain message.
- Refused: Word, PowerPoint and Excel, **txt and md**, and executables and scripts. Everything else is allowed; anything unusual becomes a plain download card.
- A board file item stores `{ type: 'file', fileId, name, contentType, sizeBytes }` — an id, never a browser URL.
- **The refusal is a toast**: it pops up, **names the exact refusal** ("Word, PowerPoint and Excel files can't go on the board (Quarterly report.docx)."), can be closed, and **fades away on its own after 10 seconds**.
- The exact refusal lines, each naming the file: Office — `Word, PowerPoint and Excel files can't go on the board (Quarterly report.docx).`; text — `Text files can't go on the board (notes.txt). Copy the text and paste it instead.`; anything executable — `That kind of file can't go on the board (setup.exe).`; too big — `report.zip is bigger than 25 MB.` The API returns the line and the page shows it verbatim in the toast.
- **A failed upload shows on the card itself**: the item on the board carries the failed state ("Couldn't upload" with Try again and the danger edge), so the thing that failed visibly cannot be used. Removing a card only drops the reference; deleting the bytes is a later sweep.
- The carry tray stays inside the board document (`tray: [...]`), so it needs no table of its own.



**What was tested and what was not (round two).** Tested in a real browser: grouping, naming, dragging a group by its name chip, ungrouping, deleting a group, undo of each; line label, arrowheads, curve, flip, a new line with its label focused; snapshots from the tray onto the board; sample picture, PDF, too big, Word refusal, failed upload and Try again; the three "file over" states; the empty board and empty tray states; Saving and Couldn't save states; the Overview Carry buttons and tray, and the Scratchpad picking them up; the fonts list and applying fonts; dark mode on the new cards; phone width (a 390 px preview) on both pages. **Not tested:** dropping a real file from the computer, pasting a picture, the system file chooser (the design tool cannot do these; the code paths are the same as the sample buttons), dragging a chip from the tray with the mouse (native drag and drop, the + button path was tested), keyboard Tab to a line, Ctrl + scroll zoom, a trackpad pinch.

**Things the board still does not do, so Opus does not assume they exist:** several boards, saving the board itself (the content resets when the page reloads, only the view, the tray and the key changes are remembered), word level formatting across paragraphs, per word fonts, and keys for Hand, Fit, group and zoom. Ctrl + scroll zoom and a trackpad pinch were written but **could not be tested** in the design tool.

Not decided yet: where "save this view as a shortcut" lives on the Overview (the panel no longer has the button), renaming a saved view, exporting or importing shortcuts.

### Overview: things worth saying about intent

- **Overview is for spotting, Browse is for acting.** If a design choice ever makes the Overview feel like it wants to be an editor, move that part to Browse.
- **One selection drives everything.** Click a slice, a bar or a chip and every number on the page agrees. If a future widget can't follow the selection, it doesn't belong on this page.
- **The numbers must be trustworthy.** A count that doesn't match Browse is worse than no count. When unsure, hide the link (see rule 5 in the Open in Browse section).
- **Plain words.** People using it aren't developers. Prefer "A similar row exists" over "duplicate", "Try again" over error codes, with technical details one click away.

### Dark mode (decided 2026-10-07)

**Intent: dark mode is the light design carried over, not a second design.** Same layout, same components, same behaviour, same words, same shortcuts, same states (loading, empty, error, out of date, one sector, two rows, phone). Only the colours change. If something is added to the light design later, it exists in dark mode automatically.

**The switch**
- A **button** in the nav bar, in the row next to the admin pill, on every admin page (Overview and Scratchpad). **Not a slider and not a toggle track**: one round button, press it and the whole page changes at once.
- In **light mode it shows a sun**, drawn dark on the light page. In **dark mode it shows a moon**, drawn light on the dark page. The icon uses `currentColor`, like every icon in this design, so it always matches its text colour.
- The label for screen readers and the hover text says what pressing it does: "Switch to dark mode" while in light, "Switch to light mode" while in dark.
- The choice is saved per person (with the other per person settings, the user confirms storage first, browser storage is fine as a first step) and is the same on every admin page. Until the person has chosen, follow the system setting (`prefers-color-scheme`). The design boards always open in light so reviews start the same way, and each board remembers its own choice only while it is open.
- Changing mode fades the colours over about 300ms and nothing moves or reflows. Respect reduced motion (no fade).

**What the colours do (the idea, not exact values)**
- Page and cards: a near black page (the board preview uses about `#141414`), cards a touch lighter than the page, thin borders a little lighter again. Not pure black, not pure white anywhere.
- Text: a soft off white for main text (about `#e2e2e2`), the usual grey steps for secondary text. Everything must keep **4.5:1 contrast** against its background (3:1 for text 24px and above and for icons that carry meaning). Check the grey captions especially, they are what usually fail.
- **The one signal colour stays orange**, a little lighter and warmer in dark mode so it keeps contrast on near black (the board preview shows a coral orange). It still means "this is selected" and nothing else.
- **Charts keep their logic and flip their shades**: on light the main ink is black and the greys step lighter, on dark the main ink is off white and the greys step darker. In the connected circle and bars card, slice one is the strongest shade and the last slice the faintest, in both modes, so the stacked bars, the legend and the circle always match each other. A picked slice is orange in both.
- Buttons: the filled buttons (Open in Browse, the picked chips, the active toggles) swap: light mode is black with white text, dark mode is off white with black text, orange buttons stay orange with dark text.
- Skeleton blocks, the shortcuts panel, the toast, the tooltips and the form fields all use the same dark set, the toast turns light on the dark page so it stands out.

**How to build it (Opus)**
- Define the colours once as **CSS variables in `angular/src/styles.css`**, a light set and a dark set (for example under `[data-theme='dark']`), and have every component use the variables. The user's rule already says colours only come from those variables.
- **Do not copy what the design boards do.** The boards build the dark preview by drawing the light design and inverting it with a CSS filter. That is only a quick preview so you can see the dark page, the exact colours are not meant to be copied, and filters on a whole page break fixed position elements (they are applied to the pieces separately in the board for that reason).
- Set the page background and `color-scheme` so scrollbars and native controls match.
- Check every state and the phone width in both modes before calling it done, plus the focus ring (the orange outline must be visible on both).

### The Overview and Scratchpad tabs

In the prototype the two tabs in the top bar are real links between the two boards (`href="Scratchpad-Light.dc.html"` and back), and the keys Go to Overview / Go to Scratchpad (G then O, G then S, and Next/Previous page) click those same links. That is only the board's way to move between files. In the app these are two routes in the admin area, both behind `adminGuard`, and the keys call the router. Keep the key and the tab pointing at the same place.

### What the board does not decide

Storage format, API shape, the table for scratchpad and shortcuts, how the keyboard listener is wired, and the exact animation timing are Opus's choices. Confirm anything that touches the model with the user first (see `model-change-needs-migration`).

## How to check your work

1. Open Browse with each URL above and confirm the filters show as active and the row count matches what the Overview board says for the same filter. The board uses generated sample data, so compare against the real table, not the board.
2. Try the boundaries: a row priced exactly 2.500, a row released on 2014-12-31, a row with no price.
3. Try a bad URL (`/?sector=Nope&flags=banana`). It should just show Browse with no crash.
4. Clear filters in Browse and check the URL params don't come back.

## Session handoff — Scratchpad, 2026-10-08

Branch `scratchpad-canvas`, off local `main`. When this was written nothing was committed; it was all committed afterwards (`066ede9`, then the migration in `0084d98`). See "Update 2026-10-09" at the end for what changed since.

### Built and verified

- **Browse filter visibility** — a filter control renders only when the whole loaded table has something it could match, and a filter that is switched on stays visible so it can be cleared. Independently verified by the critic, 30/30.
- **Scratchpad slice a** — endless canvas (pan, zoom toward the pointer clamped 10–400%, Fit / 100% / Selection), industry cards, sticky notes and text boxes, single selection, **undo and redo covering moves, deletes and typing while a note has focus**, per-person autosave, and the view remembered.
- **Pass 2** — box select, groups (create, name, ungroup, delete), rich text (bold, highlight, font family and size stored as runs, across paragraphs), and plain glued lines.
- **Page chrome** — the page title, Shortcuts plus the save pill on the header row, the context strip, a grouped icon toolbar (Tools and Add), the empty-board state, and the footer note.
- **Save state** — exactly three honest states: **Save** (unsaved), **Saved** (the server confirmed), and **Failed to save** with Try again. A 409 reads "This board was changed somewhere else." with Reload and stops retrying. Saving happens on change (about 700 ms after a pause) and every 2 minutes.
- **Pass F** — line labels as pills, arrowheads None / One end / Both ends, and Straight / Curved with Flip.
- Last measured: `ng build` 0 warnings at 441.60 kB; `ng test` 141 passed and 8 skipped. The critic scored the combined slice-a and pass-2 state 9.5/10; the newest batch (save state, Pass F, keys trim, rank and 390 px fixes) was still being verified when this note was written.

### Written, but not built and not applied

- **`GET /industries/top?by=price&limit=3`** and **`GET /industries/by-ids?ids=`** are written in `api_v2/Endpoints/IndustryEndpoints.cs`. The first gives the rail its three most expensive rows; the second refreshes cards without loading the table.
- **Item e file storage** is written: `Model/ScratchFile.cs`, `Data/ScratchFileStore.cs`, `Endpoints/ScratchFileEndpoints.cs`, the DbContext wiring, the `Program.cs` registration, `Scratchpad:Files` = `../scratchpad-files` in both appsettings files, and `/scratchpad-files/` in `.gitignore`. Endpoints: `POST /scratchpad/files` (multipart, 25 MB cap answering 413, refusals using the exact strings in the section above), `GET /scratchpad/files/{id}` (nosniff; images and PDF inline, everything else including SVG as an attachment), and `DELETE /scratchpad/files/{id}` (row and disk file). All admin only.
- **The `AddScratchFiles` migration is NOT generated and NOT applied.** The API code compiles cleanly (a throwaway-output build gave 0 warnings, 0 errors without stopping the running API), but it has never been run, so the model and the database are still apart.

### The safe stopping point

- The API on `:5005` is the build from *before* the file-storage code, so it matches the database, which has `ScratchBoards` applied and no `ScratchFiles` table. **Do not build the new API until the migration exists**, or its model will not match the database.
- Everything above is uncommitted on `scratchpad-canvas`.

### Coder notes — frontend pass

Files under `angular/`:

- New: `services/scratchpad.ts`, `services/scratchpad.spec.ts`, `services/scratchpad-save.spec.ts` (the 8 skipped stress specs), and `Components/scratchpad/` with `scratchpad.ts`, `scratchpad.html`, `scratchpad.css`, `scratchpad.spec.ts`, `note-editor.ts`, `note-editor.html`, `note-editor.css` and `rich-text.ts`.
- Modified: `app.routes.ts`, `app.html`, `app.css`, `app.ts`, `app.spec.ts`, `services/shortcuts.ts`, `services/shortcuts.spec.ts`, `services/industry-api.ts`, `models/industry.ts` and `styles.css`.
- Not this pass: `Components/my-components/*` (the Browse filter work) and everything under `api_v2/`.

Traps that cost time and will cost the next agent time:

- PowerShell eats an unquoted `@e12` ref, so agent-browser clicks silently do nothing. Always quote: `click '@e12'`.
- `agent-browser`: `open` never returns (run it capped in a job); `set viewport 390 844`; `network route "**/scratchpad" --abort` then `network unroute` (there is no bare offline command); `eval` returns a JSON-encoded string, so it needs decoding twice.
- Killing your own browser processes trips the DSH job runner (exit code 4294967295) even though the kill worked. Check the state afterwards with a plain command, not another kill.
- Process queries self-match — filter `Name -eq 'chrome.exe'`.
- A running `dotnet run` locks `bin/Debug/net10.0/api_v2.exe` and `.dll`. Stop it before `dotnet build`, and NEVER generate a migration with `--no-build` while it runs — that reads the stale dll and produces an EMPTY migration.
- The floating note toolbar translates in the layer units once the board is scaled, so the offset must be multiplied by `1/zoom` or it sinks onto the words when zoomed out; the canvas has overflow hidden, so the bar also needs nudging back inside.
- The canvas captures the pointer on pointerdown, so any control inside it (the line label pill) must stopPropagation on pointerdown or its click is lost.
- contenteditable formatting must run on mousedown, not click, or the selection is already gone; the editor must redraw from an external counter, not from the blocks signal, or the caret jumps while typing.
- A typing burst must begin on input (`begin()` is idempotent), not only on focus, or typing after an undo has no snapshot; and the live text must call `saveSoon()`, or text saves only on blur and a reload loses it.
- Do not `structuredClone` the whole board on wheel, drag or typing paths; patch one item.
- Vitest: the API client retries 5xx, so a load-failure spec must play out four attempts with `advanceTimersByTimeAsync`; fake timers must be on before touching the service.

### Critic verification — 2026-10-08

Batch: save-state rework, Pass F (LINE bar), P/M keys trim, rank removal, 390 px fix, plus regressions. **Verdict: FAIL — 5/10.** Every check in the batch passed except one ship-blocking save-state defect: a slow link can make the board stop saving while the pill says "Saved". Everything else is verified good.

**The blocker (repro).** After a 409, `conflict` is set true and is only cleared in `load()` (services/scratchpad.ts:121). A save already in flight that later succeeds sets `saveState='saved'` without clearing `conflict` (services/scratchpad.ts:520-522), so the pill shows "Saved", the Reload button disappears, `saveSoon()` returns early (line 502) and every later change is silently dropped. Also, `saveNow()` does not serialise requests, so on a link slower than the 700 ms debounce one tab can 409 itself: PUT2 carries the same stale `updatedAt` as PUT1 after PUT1 bumped it. Repro (Chrome, dev server): patch `window.fetch` to delay PUT /scratchpad by 1500 ms, click New note at t=0 and t=900 ms, wait. Raw: putTimes 701,1608,2912; transitions `101:Save > 3204:This board was changed somewhere else. Reload > 4501:Saved` (PUT3's success at 4501 masks the conflict). Then add a third note at t=6600: items 24->25, `puts` stayed 3, pill "Saved" — the change was never sent.

**Verified working (raw observation).**
- ng build: exit 0, Initial total 441.60 kB, no warning lines. `ng test --watch=false`: 141 passed | 8 skipped (149), 17 files, exit 0; scratchpad-save.spec.ts reports `(8 tests | 8 skipped)` — left skipped on purpose.
- Save transitions: on load `pill good | Saved`; after a change `pill ask | Save`; after the server confirms `pill good | Saved`.
- A change during flight: 100 ms sampling gave `101:Save > 3204:... > 4502:Saved` (bounded, converged, never a premature Saved).
- Failure: PUT aborted -> `pill bad | Failed to save ... btn=Try again`, change kept (25->26 on the page); unroute + Try again -> `pill good | Saved`; reload -> 26 items, nothing lost.
- 409 (two real tabs): tab 2 saved first, tab 1's PUT answered 409 -> `pill bad | This board was changed somewhere else. Reload | btn=Reload`; exactly ONE PUT in the next 7 s (no auto-retry); Reload -> `pill good | Saved`.
- Periodic save: `setInterval`/`clearInterval` instrumented across SPA navigation -> `clear:7` on leaving /scratchpad, `set:120000:208` on returning (PERIODIC_SAVE_MS = 120000). 135 s idle -> "No requests captured" (zero scratchpad requests).
- Pass F: the context bar reads `Line None One end Both ends Straight Curved Flip Delete line`; a new line starts selected with its label box focused (`INPUT|line-label`); typing "depends on" renders the pill; Both ends sets `marker-start=url(#sl-arrow)` AND `marker-end=url(#sl-arrow)`; Curved changes d from `M ... L ...` to `M ... Q 688.221 -301.426 1093.986 -473.377`; Flip moves the control offset from (16.73,67.97) to (-16.73,-67.97); each change is one undo step (heads -> none, curve -> L, flip -> pre-flip Q, label -> "depends on", redo -> "changed-label"); Delete line 2 -> 1 -> undo 2. A real pointer click on the pill (`find text "depends on" click`) selects the line and shows the LINE bar — the pointerdown stopPropagation fix holds.
- Keys trim: rail hint is `Keys: V select, L line, N new sticky, T new text box. Esc goes back to select, Delete removes what is selected.` Pressing P or M leaves the active tool on Select and the canvas class unchanged; L -> Line and V -> Select still work.
- Rank: 0 `.card-rank` elements on the board.
- 390 px: viewport 390x844, `.canvas` top = 630 (head 83, rail 198, bar 120, context 38), so the board is on the first screen; light and dark both look right.
- Regressions: focused typing `PG-GATE-A` -> Ctrl+Z -> `PB-GATE-DUR` -> Ctrl+Y -> `PG-GATE-A` (focus stayed in the editor); blur undo/redo; no-blur `PG-GATE-DUR` survived a reload. Hand pan translate(183.96,504.68)->(-16.04,384.68); one Ctrl+wheel at (600,500) kept the world point under the cursor (delta ~0.1) and clamped at exactly 400% and 10%; Fit -> 14%, 100% -> 100%, Selection zoomed on the picked item. A new note landed with `overlaps: none` (27 -> 28 items); Delete-only-selected 28 -> 27 -> undo 28; view reload 305% -> 305% with 28 items; dark bg rgb(20,20,20) / text rgb(226,226,226) / muted rgb(163,163,163); agent-browser page errors empty.

**The three earlier defects — fixes hold.** (1) The rail keys no longer list P/M and both keys do nothing. (2) No rank badge is drawn on any card (0 `.card-rank`). (3) The 390 px canvas top is 630, on the first screen.

**Could NOT check.** The 8 stress specs in services/scratchpad-save.spec.ts are deliberately skipped and were not unskipped or run. `network route --body` cannot set a 409 status, so the conflict needed a real second tab. The in-flight/self-conflict repro uses a patched `window.fetch` to add 1500 ms — an inference about a slow link, not a real slow link. Not covered: a real trackpad pinch, file drop/paste (slice e), a full WCAG sweep, and the API size/item/updatedAt guards.

**Next agent must know.** The conflict path is not finished: when a later save succeeds, clear `conflict` and re-arm saving, or serialise `saveNow()` and advance `updatedAt` per in-flight request, so one tab can never 409 itself. Until then a slow link can silently stop the board saving while the pill says "Saved". Everything else in this batch is verified and can be built on.

## Update 2026-10-09

- **The conflict blocker is fixed in code.** `saveNow()` in `services/scratchpad.ts` sends one save at a time: a save asked for while one is out waits, then goes with the `updatedAt` the first one brought back, so a tab can no longer 409 itself. A success that arrives while `conflict` is set no longer turns the pill to Saved. Covered by the spec "sends one save at a time, and the next one carries the newer updatedAt". `ng test` 142 passed, 8 skipped; `ng build` 441.60 kB, no warnings. **Not yet re-run in a real browser** with the slow-link repro above, which needs a signed-in admin.
- **The `AddScratchFiles` migration** was committed in `0084d98` and applied to the local database when the API was next started on 2026-10-09.
- **Still to build:** the page side of files (item e: drop, paste, upload card, refusal toast), the carry tray, and the Mouse rows in the shortcuts panel.

