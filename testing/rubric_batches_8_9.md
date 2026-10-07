# Stock Listing grading rubric (batches 8 and 9)

Written by an Opus 5.5 critic from the claims in README.md, plan.md and report.txt. 10 criteria, 1 point each, pass mark 7. A criterion scores 1 only when every part of its pass condition holds. A partial pass scores 0.

## Setup before grading

* Run a throwaway API and page, never the real database, the same way `testing/README.md` describes. Sign in as an admin.
* Seed 300 rows. One row needs a name of 40 characters or more, for example "Horizon Water and Desalination Holdings LLC". Add one custom field on the Fields page and give it a value in a known number of rows, for example 12.
* Press Back up now on History. Then delete 20 rows so the table has 280 and the backup has 300. Use a backup made by this build. Older backups have no row count, and the panel then says "its rows", which fails criterion 1.
* Make one backup from another table layout by changing the migrations list in that backup's `backup.json`.
* Treat `testing/contrast.py`, `testing/check_design.mjs` and report.txt as claims. A criterion passes on what the grader sees and measures in the browser, never on a script's own "ok".

## The criteria

### 1. Restore preview says what will happen

* **Observe:** History page, 1280px wide, light. In the Backups section, click Restore on the backup made during setup and read the panel that opens.
* **Pass:** The panel names the backup's date and time, says "300 rows instead of the 280 in the table now", says accounts and sign ins stay as they are now, and says the table as it is now gets saved to History first.
* **Fail:** Any of those four facts is missing or wrong, the counts do not match the setup, the panel says "its rows", or the panel does not open.

### 2. Restore is guarded and reports its result

* **Observe:** The same page and width, light. Look at the backup from another layout. Then, in the open panel, type "restore" in lower case, then "RESTORE", then click Restore and wait.
* **Pass:** The other layout backup shows "Other table layout" and its Restore button has the disabled attribute. The panel's Restore button stays off for "restore" and turns on only for "RESTORE". After the restore, a line reads "Restored. The table has the 300 rows from that backup now, rules version N." with a real number for N, and the table as it was shows up as a new version at the top of Saved versions.
* **Fail:** The other layout button can be clicked, the button turns on for any text other than exactly RESTORE, the result line is missing or has no row count or no rules version, the row count is not 300, or no copy appears at the top.

### 3. Delete says what went

* **Observe:** Main table at 1280px, light. Click Delete on the long name row, read the question, then confirm. Do the same on another row at 390px. Last, on the Fields page at 1280px, delete the custom field.
* **Pass:** At 1280px the question reads "Are you sure you want to delete <name cut at 24 characters>?". After confirming, the line "Deleted 1 row from Industries: <full name>." appears above the table. At 390px the visible text is "Are you sure you want to delete it?" and the confirm button's aria-label and title both read "Delete <full name>". On Fields the message reads "Deleted <label>. Its values were removed from 12 rows in Industries." and the number matches the setup.
* **Fail:** Either question lacks the wording above, no line appears after a delete, the line names the wrong row or table, the phone button has no name in aria-label or title, or the Fields number is wrong or missing.

### 4. Phone layout at 390px

* **Observe:** Main table and History at 390px wide, light, signed in as admin so all seven nav items show.
* **Pass:** All of these hold:
  * `document.documentElement.scrollWidth <= window.innerWidth` is true on both pages.
  * All seven nav items sit in one row inside 0 to 390px.
  * Every visible nav label has a computed font size of 12px (0.75rem) or more.
  * The long name cell ends in "...", meaning its computed `text-overflow` is `ellipsis` and its `scrollWidth` is greater than its `clientWidth`. The cell's right edge is at or left of the pinned Actions column's left edge.
  * The History cards show the count with its word, for example "300 rows" and "1 row".
* **Fail:** Any page scrolls sideways, a nav item wraps or falls outside 390px, any label measures under 12px, the long name is cut with no "..." or sits under the Actions column, or a History card shows a bare number.

### 5. Problems sit under their own box (accessibility)

* **Observe:** Main table at 1280px, light. Leave Name empty, pick no Sector and press Add. Then, on the account page, try a new password of 6 characters, then two new passwords that differ, then a new password equal to the current one, with the Network tab open.
* **Pass:** Each problem shows directly below the box it belongs to and above the next field. Each box with a problem has `aria-invalid="true"` and an `aria-describedby` that matches the id of its own message. No field problem is repeated in a summary line by the Add button. On the account page all three tries show a plain message and the Network tab records no request.
* **Fail:** A problem shows away from its box or only in the summary line, aria-describedby is missing or points at the wrong id, or any of the three account tries sends a request.

### 6. Text contrast in light and dark

* **Observe:** Main table and History at 1280px, first light, then dark (set `prefers-color-scheme: dark` in the browser). Make a disabled button show, for example the restore panel's Restore before typing, and view a similar (amber) row that has a danger red mark or text.
* **Pass:** Use the WCAG formula on the computed colours. Each of these pairs measures 4.5:1 or better in both schemes: muted text and faint text (placeholders, helper text) on the page background and on the card surface, danger red on the background and on the amber row, normal text on the amber row, and disabled button text on its own background. The disabled button's computed opacity is "1" with a grey fill. In dark, danger red computes to `rgb(253, 162, 155)`, which is #fda29b.
* **Fail:** Any pair is under 4.5:1 in either scheme, a disabled button is faded with opacity below 1, or dark danger red is any other value.

### 7. One visible keyboard focus ring (accessibility)

* **Observe:** Main table at 1280px, light and then dark. Press Tab from the top of the page onto a nav link, then onto the Search box, a flag mark in the table and a Delete button. On Requests, Tab onto a tab.
* **Pass:** Every focused element shows exactly one visible ring. On the nav link and the request tab, `getComputedStyle(document.activeElement)` gives outline style `solid`, width `2px`, offset `2px` and the text colour, in both schemes.
* **Fail:** Any of those elements shows no ring, shows two stacked rings (outline plus glow), or the link's outline is not 2px solid with a 2px offset.

### 8. Refusals: back link, settings file, guest view

* **Observe:** Signed out, at 1280px, light, open `/login?back=` with each of `/history`, `//evil.com`, `/\evil.com`, `https://evil.com` and `%0d%0a`, and sign in each time. Signed in as admin, on History, import as settings a 2 MB file, a text file that is not JSON, a JSON file holding a list (`[]`), and a JSON object with no app field, with the Network tab open. Last, sign out and look at the main table.
* **Pass:** Only `/history` lands on /history and the other four land on `/`, never on another site. All four files are refused on the page with no request sent: the 2 MB file says "That file is too big to be a settings file", and the list and the object with no app field say "That isn't a settings file from this app. Use a file made with Export settings". As a guest, the main table has no Add form and no Actions column, and the Network tab shows no call to `/requests` or `/requests/count`.
* **Fail:** Any bad back value leaves the app or lands anywhere but `/`, any bad file sends a request or shows no message, or a guest sees the Add form, the Actions column or a requests call.

### 9. Wording and hints

* **Observe:** At 1280px, light, look at the sign in page, the main table toolbar and headers, the Connected badge (hover it or read its title), and History's Keep old versions with both boxes empty. With the network throttled to Slow 3G, open History and watch the Backups list. On the people page, with `navigator.clipboard` removed in the console, add a person and press Copy.
* **Pass:** All of these hold:
  * The sign in card title reads "Welcome back" and the card's left edge lines up with the page title.
  * The search placeholder reads "Search by name" and the entries control reads "Show 10 entries" in sentence case, and no small label anywhere is in capitals (table headers, filter labels, the Connected badge, Print and Export CSV, tags, the "Showing 1 to 10" line).
  * The Connected badge's title is "The page can reach the database".
  * With the boxes empty, no "days" or "versions" unit shows, so the page never reads "Never days".
  * "Loading backups" with a spinner shows before the list fills in.
  * The people page says "Select the password and copy it yourself".
* **Fail:** Any of these strings is missing, different or in capitals, any small label is in capitals, the card is centred while the page title is left aligned, a unit shows next to an empty box, the Backups list is blank while it loads, or Copy fails with no message.

### 10. Https

* **Observe:** Start with `start.bat https`, or by hand with `dotnet run --launch-profile https --Https:Required=true` and `ng serve --ssl`. Run `curl -sI http://localhost:5005/health`, then open https://localhost:4200 and check the Network tab. Then start the API on plain http only and read its window.
* **Pass:** curl returns 307 with a `Location` header on `https://localhost:7165`. The page loads over https and every API call in the Network tab goes to `https://localhost:7165`. The plain http start prints "Signing in goes over plain http here..." and the https start does not.
* **Fail:** Plain http answers anything but 307 to https, the https page calls an http API (mixed content), or the warning is missing on plain http or shows on https.

## Captures for one pass

Take these in order, because the restore and deletes change the data.

1. **History at 1280px, light, Slow 3G throttling.** Screenshot the "Loading backups" line, then the Backups list with row counts and the disabled "Other table layout" button. Then open Restore on the setup backup and take one screenshot with "restore" typed and one with "RESTORE" typed. In the console, check the other layout button's disabled attribute. Covers 1, 2 and part of 9.
2. **History at 1280px, light, after confirming the restore.** Screenshot the result line and the new version at the top of Saved versions. Then empty both Keep old versions boxes and screenshot that section. Covers 2 and part of 9.
3. **Main table at 1280px, light.** Screenshot the long name delete question, then the "Deleted 1 row from Industries" line. Screenshot the toolbar and headers. Read the Connected badge's title in the console. Press Add on the empty form and screenshot it, then read aria-describedby, the message ids and aria-invalid in the console. Tab onto the nav link, the search box, a flag and a Delete button, screenshot each focus, and read the computed outline. Covers 3, 5, 7 and part of 9.
4. **Main table and History at 390px, light, admin.** Screenshot the nav, the long name row and the "Are you sure you want to delete it?" state. In the console, run the scrollWidth check on both pages, read each label's font size, the name cell's text overflow and the edges of the name and Actions cells, and the confirm button's aria-label and title. Screenshot a History card. Covers 3 and 4.
5. **Fields at 1280px, light.** Screenshot the delete message for the custom field. Then on the account page, try the three bad passwords with the Network tab open and screenshot each message along with the empty request list. Covers 3 and 5.
6. **Main table and History at 1280px, dark.** Screenshot a disabled button, an amber row with danger red, and a focused nav link. In the console, read the computed colours and the disabled button's opacity, and work out the ratios for every pair in criterion 6. Do the same pairs again in light. Covers 6 and 7.
7. **Sign in, History import, people page and guest view at 1280px, light.** Screenshot the sign in card. Record where each of the five back values lands. Screenshot each refused settings file next to an empty Network tab. Screenshot the copy message with the clipboard removed. Sign out, then screenshot the guest table and its Network tab. Covers 8 and part of 9.
8. **Terminal and the https page.** Save the curl output that shows the 307 and Location, a screenshot of the https page's Network tab with the API calls on 7165, and the API window text from a plain http start and from an https start. Covers 10.
