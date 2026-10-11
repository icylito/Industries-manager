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

**One rule, ICU, in three places.** Round 1 of the critic showed my first version, three hand-written rules, disagreeing on Hindi, Greek, Turkish and rare Chinese names. It is now ICU, the Unicode library Postgres, .NET and browsers all build on:
- **Database:** the collation `name_rule` (`und-u-ka-shifted-ks-level1-kv-currency`, not deterministic), used by the unique indexes and every name comparison.
- **C#:** `Names.Same`, `Names.HasNoLetters` and `Names.Key` (an ICU sort key, for grouping in memory) in `api_v2/Rules/Names.cs`.
- **Page:** `sameName` and `hasNoLetters` in `angular/src/app/services/name-key.ts`, through the browser's `Intl.Collator`. The page only uses it to warn sooner; the API decides.

Hindi काम and कम stay two words, Greek ΟΔΟΣ and οδος are one, and Turkish İzmir and izmir are one.

**Where the three still differ (critic round 2):**
- **ICU versions:** Windows' copy of ICU, which .NET uses, is older than the one in Postgres. They disagree on very new characters (Unicode 16 emoji) and on a few symbols such as ™, Ⓐ, ℃, № and ½. The page also handles symbols differently.
- **Effect:**
  - About 1% of tested pairs disagree.
  - For such names, a Bring back preview can miss a similar row, and then the Bring back is refused with "already taken" (nothing is changed).
  - A restore of a version holding such twins can still be refused.
  - The database always has the last word, so nothing wrong is ever saved.
- See "Left open" below.

The database and C# are held to the same 16 example pairs in `testing/check_names.py`, and the page to the same pairs in `name-key.spec.ts`.

Your real Postgres 18 has ICU; I checked read-only, and it has 883 ICU collations.

**Migrations.** These are not applied to your real database yet. They apply when you restart `start.bat`, and the repo rule says you see them first. Here they are:
- `OneNameRule`, on the data chain.
  - **Up:**
    - Makes the collation `name_rule` if it isn't there.
    - Flags a later company whose name matches an earlier original as a copy of it, the same as an import does.
    - Gives a later live table with a clashing name its number at the end, e.g. "Sales (12)", since a table can't be flagged. If that name is taken too it tries "Sales (12-2)" and so on, so the rename never makes a new clash.
    - Swaps the case-only unique indexes for `name_rule` ones.
  - **Down:** puts the old indexes back. Flags and renamed tables stay, because they're data and the old rule allows them.
- `OneUsernameRule`, on the state chain.
  - **Up:** adds `Users.NameClash`, flags every account whose username matches an older one, and adds a unique index that skips flagged accounts.
  - **Down:** removes the flag and the index; accounts and usernames are untouched.
  - Sign-in never changes.
  - Settings shows a flagged account in red: "Same name as X. Rename or delete one."
  - Renaming or deleting either account clears the flag.
- Both migrations make `name_rule` if it isn't there. A Down drops it only when no index of either chain still uses it.
- **History versions saved before the rule** may hold two originals that are one name now. Restoring such a version flags the later one as a copy, the same as the migration does, instead of refusing the restore.

**Assumptions**
- Sector options are a choice list, not names, so they keep their old case-only matching.
- For accounts that already clash, you chose "list them, admin decides" earlier, so nobody is renamed automatically. Tables, which can't be flagged, get their number added instead.
- Accents, case, width, spaces, punctuation, symbols and currency signs are what ICU's level 1 with "shifted" handling ignores. Vowel signs in scripts like Hindi count.
- But level 1 also ignores marks that make different words in Japanese and Thai, which I didn't foresee. バス and パス (bus, pass), ビール and ビル (beer, building), and ไม่ and ไม้ (not, wood) count as one name. See "Left open" below.
- ICU can change between versions. Postgres records the version per collation, and warns if a later Postgres has a different one; reindexing fixes that.

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

## 4. The critic

The critic was an independent agent, not told the pass mark (7 out of 10), with access to the test setup only. It graded everything since phase 2 landed (`81ead36..HEAD`):
- the hand-over and adopt fixes
- the profile card with name and picture
- the shorter confirmations
- the icon fix and the fonts
- phase 3

Its reports are in the session's scratch folder under `critic3-1`, `critic3-2` and so on.

### Round 1: 6.8 out of 10, no cap

No data loss, no security hole. Defects, and what I did about each:

| # | Defect | Fix |
|---|---|---|
| D1 High | `OneNameRule`'s table rename could itself clash (`Sales`, `sales.`, `Sales 2`), so the index failed and the API wouldn't start | The rename keeps trying "(id-2)", "(id-3)"… until no table has the name. The migration fixture now holds exactly that case. |
| D2 Medium | The "one rule in three places" disagreed on Hindi, Turkish, Greek and rare CJK, despite claiming it never did | ICU in all three places (above). `check_names.py` holds the database and C# to 16 pairs, the page's unit test the same pairs. Only partly fixed: see round 2. |
| D3 Medium | A History version from before the rule with two old-rule twins could no longer be restored | The restore plan flags the later twin as a copy. `check_names.py` restores such a version. Names of only symbols no longer count as a clash. |
| D4 Low/Med | A 58-character name with no spaces made the phone page scroll sideways | The `@name · role` line wraps (`overflow-wrap: anywhere`). Checked at 390 px. |
| D5 Low | WebP check without `RIFF`, no `nosniff`, a chunked upload read whole before the size check | `RIFF` and `WEBP` both required; `X-Content-Type-Options: nosniff`; reading stops at the limit. |
| D6 Low | `check_names.py` left "Ticker" fields behind | Its cleanup sends `basedOn`, and it also removes ones left by older runs. |
| D7 Low | Test gaps: no hand-over test, non-Latin samples, the rename case, and an unhandled `scrollIntoView` error in `ng test` | New `testing/check_handover.py` (HANDOVER OK). The samples and fixture are above. `scrollIntoView` is now only called where the browser has it. |
| D8 Low | Confirmation wording inconsistent | The Fields question is one line now. "Delete version #N for good?" and "Delete 'board'?" stay as they are on purpose: they are short and name what goes for good. |
| D9 Low | README numbers out of date, and the "never disagree" claim | Numbers fixed: walk 93 checks, fonts 48. The claim was still not true, see round 2. |

Also: the test databases held about 10,000 extra "Measure Co" rows and 45 big History versions from the Bring back stress test. That made a backup bigger than `check_backup_tables.py`'s 5 MB upload cap, so I deleted them from the test databases only.

### Round 2: 7.6 out of 10, no cap: passed

No data loss, no security hole. Round 1's defects:
- **Fixed:** D1, D4, D5, D6 and D9's numbers.
- **Accepted:** D8.
- **Partly fixed:** D2, D3 and D7. See N1.

The critic checked:
- every migration check, races (one success and no errors), profile security, and seven pages at 390 and 1366 px in light and dark
- Browse with 5,602 rows in 143 ms, and the Bring back preview in 1.1 s
- 261 unit tests, with no unhandled error

New findings:

| # | Finding | What I did |
|---|---|---|
| N1 Medium | The three ICU rules still disagree on about 1% of pairs, through ICU version differences and the page's symbol handling. This can make a Bring back preview miss a similar row, and then the Bring back is refused (nothing changed). | Out of scope (your call, 2026-10-11). The docs no longer claim they agree. |
| N2 Medium | Japanese and Thai words that differ only by a mark count as one name | Out of scope (your call, 2026-10-11) |
| N3 Low | An emoji display name showed half an emoji as the initial | Fixed: the initial is the first whole character |
| N4 Low | A display name is measured after normalising, so 20 × ﷺ is "over 60 characters" | Left as it is: a name is measured as it is saved |
| N5 Low | False doc claims | Fixed in this file. 261 unit tests now (it said 246). |

## Closed as out of scope (2026-10-11)

You decided that emoji, unusual symbols, and Japanese, Thai and other such scripts are out of scope for names, so N1 and N2 stay as they are and nothing was changed. The notes below are kept in case that changes.

- **N1:** the fix would be to make the database the only judge of names: `Names.Same`, `Names.Keys` (Bring back and Restore), field and column labels, and the Fields page's early warning would ask the database instead of comparing names themselves. The cost is one small query per check.
- **N2:** the options were (a) compare at level 2, so accents count again (Café and Cafe become two names), (b) keep level 1 with a custom ICU rule that treats Japanese and Thai marks as letters, or (c) keep it. It is (c): two such companies can still both exist, the later one flagged as a copy.

## Still to do

**The phase 3 migrations aren't on your real database yet.** `OneNameRule` and `OneUsernameRule` apply on your next `start.bat` restart. Take a backup from the page first, as before.
