# Stock Listing

A web page for the industries list. It shows the table, lets people change it, and keeps a copy of every change so nothing is lost.

## Where the project stands

Working now:
- The industries table, with search, filters, sorting, print and CSV export
- Accounts, where anyone can browse, signed in people can change rows, and admins get the Overview, Settings, History and Fields pages
- History, where every saved copy can be viewed, downloaded, pinned, restored or imported
- Nightly backups at 2:00, kept for 14 days
- Requests, for anything that needs a developer
- The Scratchpad, an admin scratchpad for working ideas out: industry cards, notes, pictures and videos, pen and marker drawings, boxes, groups, and arrows with labels to tell the story. Each person keeps several boards, listed in its sidebar to open, rename, pin or delete, with a drop zone for pictures. Undo works on everything.
- A carry tray along the bottom of every admin page. The Overview's circle or list goes in, frozen, and comes off onto a board.
- Your shortcut keys, the Scratchpad's mouse keys and light or dark are saved to your account, so they follow you to any browser.
- Tables, where managers and admins make their own tables, fill them, and delete them, with no developer
- Backups that leave as one file and can be dropped back in on History

Not done yet:
- Restoring a version saved before a table change needs a developer.
- A restore brings back the rows and rules of a version, but not its old columns. A developer has to add those back in code.

## How to start it

1. Double click `start.bat` in the project folder.
2. Two windows open. Keep them open while you work.
3. Open http://localhost:4200 in your browser.

Closing a window stops that part. If the page says it could not load the industries, the API window is probably closed or showing an error.

Other ways to start:
- `start.bat https` runs the page over https on this PC.
- `start.bat share` opens the page to phones and other PCs on the same Wi-Fi. The first time, other devices show a certificate warning. Continue past it.

## Signing in

The first start creates an admin account called `admin` with a random password. The password is printed once in the API window, so copy it then. Sign in and choose a new password.

If the admin password is lost, ask a developer to reset it. The reset is a single command that prints a new password in the API window. Ask for the flag to be removed again afterward.

Nobody can sign up alone. An admin creates each account in Settings, and the new person picks their own password at first sign in. Passwords need at least 10 characters.

Guessing is slowed down. One address gets 5 sign in tries a minute (`Auth:LoginTriesPerMinute`), and one username gets 10 wrong passwords in 15 minutes from anywhere (`Auth:FailedTriesPerName`, `Auth:FailedTriesWindowMinutes`). Past either, the page says how long to wait and keeps Sign in off until then. A right password clears the username's count. The catch: someone guessing at a name can make its owner wait out the 15 minutes.

There are three roles. A **user** can add, edit and delete rows. A **manager** can also make, change and delete tables on the Tables page, and take, download, drop in and restore backups. An **admin** can do everything, including rules, History versions and Settings.

## The pages

| Page | Address | Who | What it is |
|---|---|---|---|
| Browse | `/` | Anyone | The table |
| Sign in | `/login` | Anyone | Sign in |
| Your account | `/account` | Signed in | Your password, and sign out |
| Overview | `/overview` | Admin | The table at a glance |
| Scratchpad | `/scratchpad` | Admin | A board to think with your industries |
| Settings | `/settings` | Admin | Accounts and who can sign in |
| History | `/history` | Admin, and managers for the Backups part | Every saved copy of the table, and the backups |
| Fields | `/fields` | Admin | Labels, limits and custom fields |
| Tables | `/tables` | Signed in to look, manager or admin to change | Tables the team makes itself |
| Requests | `/requests` | Signed in | Work that needs a developer |

The old `/users` address opens Settings. Every page jumps back to the top after 5 minutes without activity.

## Saving and undoing changes

- Adding, editing and deleting rows is saved right away. Each delete says which row went.
- Every change to the fields saves a copy of the table first.
- On History, Restore puts a saved version back. The table as it is now is saved first, so the restore can be undone from the same page. Restore asks for a short reason.
- Backups are listed at the bottom of History. Restoring a backup asks you to type `RESTORE`. It brings back the industries, their rules, requests, settings and every table from the Tables page. A full backup of right now is taken first, so a restore can be undone by restoring that one.
- **Download** gives a backup as one `.zip`. Drop that zip on the box on History, on this PC or another one running this app, and it joins the list. Only a zip this app made is accepted: every backup is signed with a key in `backup-key/`, so keep that folder safe and never share it. Backups made before signing can still be restored here, but not downloaded as one file.
- Deleting a table on the Tables page puts it in the bin for 14 days. **Bring back** returns it with its rows.

## Where the files go

| Folder | What is in it |
|---|---|
| `backups/` | The nightly and manual backups, and dropped in ones |
| `backup-key/` | The key that signs backups. Keep it, and keep it private |
| `user-tables/` | A readable JSON copy of every table on the Tables page, one file each, plus `_index.json` with sizes. Tables in the bin are in `user-tables/deleted/`. These are copies only: the database is the real storage, and editing a file changes nothing |
| `scratchpad-files/` | Files put on the Scratchpad. A file no board of its owner uses any more is deleted 7 days after that was first noticed |

None of these folders go into git.

## If something looks wrong

- The top badge says History offline, or Database error: the table still loads, but saving waits or stops until the database responds. History offline clears by itself. Database error shows the reason in the table.
- The badge says API offline: the API window is closed or stopped. Start `start.bat` again.
- Saving stops with a message that someone else changed the same thing: reload the page and make the change again.

## For anyone who wants to try it

- Setup, database settings and the seed script are in `HANDOFF.md` and `docker_setup.md`.
- Changing the shape of the table needs a migration. Run `.\migrate.ps1 -Name YourChangeName` in `api_v2`, then restart the API.
- The API runs on http://localhost:5005 with Swagger at http://localhost:5005/swagger/index.html.
