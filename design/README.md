# Admin Overview and Scratchpad: design files

Everything here is a **design prototype**, not Angular code. Nothing in the app has been changed. Opus builds the real thing from these.

Live version (private link, needs the owner's account): https://claude.ai/artifact/HjAzUY9spw4zfnZ9TDXgY5

## Read first

1. [OVERVIEW_HANDOFF.md](OVERVIEW_HANDOFF.md) is the brief. It says what each part is for, how it should feel, what the board only fakes, and what to build properly. Where the board and the handoff disagree, the handoff wins. (A copy also sits at the repo root; this one is the same file.)
2. Then open the boards and click through them.

## Files

| File | What it is |
|---|---|
| `C-Signal-Light.dc.html` | The **Overview** page, light and dark (sun/moon button). Charts, filters, compare, find, shortcuts panel, Carry buttons and carry tray. |
| `Scratchpad-Light.dc.html` | The **Scratchpad** page. Endless canvas, select several, groups, lines with labels/arrowheads/curves, bold and highlight on selected words, 27 fonts, files and pictures, snapshots from the carry tray, save status, shortcuts panel. A PROTOTYPE strip at the top previews every state (review only, not part of the page). |
| `Main.dc.html` | A read-out page: what the code allows and the decisions taken. |
| `canvas.json` | How the boards were laid out in the design tool. Not needed to build. |

Left out on purpose: `C-Signal.dc.html`, an older dark board that was never upgraded. Dark mode is now the light design carried over, see the Dark mode section of the handoff.

## How to read the `.dc.html` files

- They are written for the design tool (`<x-dc>`, `{{holes}}`, `<sc-for>`, `<sc-if>`, a `DCLogic` class). **They do not run on their own**: `./support.js` is not in this folder. Open the live link above to use them.
- The markup is the layout and the colours to copy (inline styles, one signal colour `#d9481a`). The `<script>` at the bottom is a **sketch** of the behaviour, not code to port. `OPUS:` comments mark the places where the board fakes something or where a rule matters (undo, glued lines, dead links).
- Dead links are on purpose: "Open in Browse", "Edit in Browse", "Open in Overview", "Open". See the handoff.
- The boards keep the shortcuts, carry tray, theme and view in browser storage as a stand-in. In the app these are saved per person on the server.

## Things that need the user's yes before building

Settled since: Scratchpad boards and files are stored on the server (`ScratchBoards`, `ScratchFiles`, both migrations applied) with a **25 MB** file limit. Still to confirm before building: keeping shortcuts, the mouse keys and the theme per person on the server (they live in the browser today). The Overview and Scratchpad stay admin only (`adminGuard`) for now.
