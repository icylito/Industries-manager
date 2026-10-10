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

## 3. Phase 3: one name rule

Two names are the same when they match after ignoring capital letters, accents, spaces, punctuation and symbols, in any script. "Acme, Inc.", "ACME inc" and "acme-inc" are one name; "شركة" stays "شركة". A name made only of symbols ("!!!") is refused with "A name needs at least one letter or digit".

**Where it applies:**
- company names (Browse, Add)
- table names and their column names (Tables page)
- field labels (Fields)
- usernames

Search and sorting are unchanged.

**One rule in three places, kept the same:**
- In C#: `Names.Key` in `api_v2/Rules/Names.cs`.
- In the database: the function `name_key(text)`, which the unique indexes use.
- On the page: `nameKey` in `angular/src/app/services/name-key.ts`. The page only uses it to warn sooner; the API decides.
- `testing/check_names.py` checks the database against an independent version of the rule. The C# and page versions are covered by the API checks and the unit tests.

**Migrations.** These are not applied to your real database yet. They apply when you restart `start.bat`, and the repo rule says you see them first. Here they are:
- `OneNameRule`, on the data chain.
  - **Up:**
    - Makes `name_key`.
    - Flags a later company whose name matches an earlier original as a copy of it, the same as an import does.
    - Gives a later live table with a clashing name its number at the end, e.g. "Sales (12)", since a table can't be flagged.
    - Swaps the case-only unique indexes for `name_key` ones.
  - **Down:** puts the old indexes back. Flags and renamed tables stay, because they're data and the old rule allows them.
- `OneUsernameRule`, on the state chain.
  - **Up:** adds `Users.NameClash`, flags every account whose username matches an older one, and adds a unique index that skips flagged accounts.
  - **Down:** removes the flag and the index; accounts and usernames are untouched.
  - Sign-in never changes.
  - Settings shows a flagged account in red: "Same name as X. Rename or delete one."
  - Renaming or deleting either account clears the flag.
- Both migrations make `name_key` with `CREATE OR REPLACE`. A Down drops it only when no index of either chain still uses it.

**Assumptions**
- Sector options are a choice list, not names, so they keep their old case-only matching.
- For accounts that already clash, you chose "list them, admin decides" earlier, so nobody is renamed automatically. Tables, which can't be flagged, get their number added instead.
- Accents are dropped by splitting letters apart (Unicode NFKD) and keeping only letters and digits. Full-width letters (Ｆｕｌｌ) become plain ones.

**Files touched**
- API:
  - `api_v2/Rules/Names.cs` (`Key`, `NoKeyMessage`, the SQL comparisons)
  - `api_v2/Rules/RulesService.cs` (field labels)
  - `api_v2/Tables/TableShape.cs` (table and column names)
  - `api_v2/Endpoints/UserTableEndpoints.cs`
  - `api_v2/Endpoints/IndustryEndpoints.cs`
  - `api_v2/History/TableWriter.cs`
  - `api_v2/Model/User.cs` (`NameClash`)
  - `api_v2/Model/UserTable.cs` (comment)
  - `api_v2/Auth/UserService.cs` (`UsernameTakenAsync`, `RefreshNameClashesAsync`, the empty-name check)
  - `api_v2/Endpoints/UserEndpoints.cs`
  - `api_v2/Data/StateModel.cs`
  - `api_v2/Migrations/*_OneNameRule.*`, `api_v2/Migrations/State/*_OneUsernameRule.*`, and both snapshots
- Page:
  - `angular/src/app/services/name-key.ts` and its spec
  - `angular/src/app/Components/fields/fields.ts`
  - `angular/src/app/Components/users/users.html`, `.css`, `.ts`
  - `angular/src/app/models/industry.ts`
- Tests:
  - `testing/check_names.py` (new)
  - `testing/check_migration.py` (fixtures for both migrations, and `KEPT` for tables whose rows a Down deliberately keeps)

**Checks:**
- `NAMES OK`, `SCRATCHPAD OK`, `TABLES OK`, `BACKUP TABLES OK`, `RESTORE OK` and `REFUSALS OK`.
- `MIGRATION OK` for both migrations, run with `EXPECT_CHANGED=Industries,UserTables KEPT=Industries,UserTables` for `OneNameRule` and `CHAIN=state EXPECT_CHANGED=Users` for the other.
- `WALK OK` (93 checks, including that a new database matches the upgraded one) and `DUMP OK`.
- 246 unit tests pass.
- Browser runs: the main flows 37 of 37 and the stress script 18 of 18. The red clash mark appears on Settings.
- The database itself refuses a second account or table with the same name by the rule.

**Undo:**
- Before the migrations reach your real database: revert the phase 3 commit.
- After they have reached it:
  1. Take each migration back with `dotnet ef database update <previous> --context DataMigrationsContext` (or `StateMigrationsContext`).
  2. Then revert the commit.
  3. Flags and renamed tables stay. Clear them by hand if you want: `UPDATE "Industries" SET "DuplicateOf" = NULL WHERE ...`.
