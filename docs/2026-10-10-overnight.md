# Overnight work, 2026-10-10

You asked me to keep going while you slept: fix the slow Bring back, add 20 Google fonts to the Scratchpad, then do phase 3 of the plan (one name rule). After that, stress test it and have a critic grade everything from phase 3 onward, in up to 3 rounds, then commit.

This file lists each change, every assumption I made, the files touched, and how to undo it.

## 1. Bring back froze the page: icons

Font Awesome now ships as a plain font with only the icons the app uses, instead of the hosted kit's script. The full story, numbers and undo steps are in [2026-10-10-icons.md](2026-10-10-icons.md). Commit: "icons are font awesome free as a plain font...".

Also done: your page server on 4200 was restarted. A change to `angular.json` needs a restart, and without it the page would have shown no icons. The API on 5005 wasn't touched.

## 2. Twenty more Google fonts for Scratchpad notes

There are now 48 fonts: the original 28 and these 20.

| Group | Added |
|---|---|
| Sans serif | Roboto, Rubik, Manrope, **Cairo**, **Tajawal** |
| Serif | EB Garamond, Crimson Pro, Bitter, Noto Serif |
| Monospace | Fira Code, Roboto Mono, Source Code Pro |
| Display | Anton, Alfa Slab One, Archivo Black, Righteous |
| Handwriting | Kalam, Patrick Hand, Gloria Hallelujah, Satisfy |

**Assumptions**
- Cairo and Tajawal are Arabic and Latin fonts. I added them so notes can be written in Arabic, and to replace them, swap the names in the three places below.
- I picked well-known Google families only. Each was checked against Google Fonts before adding: every request answered 200.
- The seven with one weight (Anton, Alfa Slab One, Archivo Black, Righteous, Patrick Hand, Gloria Hallelujah, Satisfy) are listed as one-weight, so the page never asks Google for a bold they don't have.

**Files touched**
- `angular/src/app/Components/scratchpad/rich-text.ts`: `FONT_GROUPS` and `ONE_WEIGHT`.
- `api_v2/Scratchpad/BoardRules.cs`: `Fonts`. The API refuses any font not on this list, so the two lists must match.
- `angular/src/app/Components/scratchpad/rich-text.spec.ts` and `testing/check_scratchpad.py`: the count went from 28 to 48. `check_scratchpad.py` also checks that the two lists match.

Nothing is loaded until a note uses a font. Opening the font list loads each name in its own face, as before. The font lists already scroll, so 48 entries fit.

**Undo:** remove the added names from `FONT_GROUPS`, `ONE_WEIGHT` and `BoardRules.Fonts`, and set the counts back to 28. A note already saved in one of these fonts would then be refused when it's saved again. To avoid that, change those notes' font first, or keep the font on both lists.

Checks: 244 unit tests pass, and `check_scratchpad.py` reports SCRATCHPAD OK (48 fonts match, a note in a listed font is accepted, an unlisted one refused).
