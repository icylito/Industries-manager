# Stock Listing

A web page for the industries list. It shows the table, lets people change it, and keeps a copy of every change so nothing is lost.

## Where the project stands

Working now:
- The industries table, with search, filters, sorting, print and CSV export
- Accounts, where anyone can browse, signed in people can change rows, and admins get the Overview, Settings, History and Fields pages
- History, where every saved copy can be viewed, downloaded, pinned, restored or imported
- Nightly backups at 2:00, kept for 14 days
- Requests, for anything that needs a developer

Not done yet:
- The Scratchpad page. Its design is in `design/`, and the build brief is in `HANDOFF.md`.
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

## The pages

| Page | Address | Who | What it is |
|---|---|---|---|
| Browse | `/` | Anyone | The table |
| Sign in | `/login` | Anyone | Sign in |
| Your account | `/account` | Signed in | Your password, and sign out |
| Overview | `/overview` | Admin | The table at a glance |
| Settings | `/settings` | Admin | Accounts and who can sign in |
| History | `/history` | Admin | Every saved copy of the table |
| Fields | `/fields` | Admin | Labels, limits and custom fields |
| Requests | `/requests` | Signed in | Work that needs a developer |

The old `/users` address opens Settings. Every page jumps back to the top after 5 minutes without activity.

## Saving and undoing changes

- Adding, editing and deleting rows is saved right away. Each delete says which row went.
- Every change to the fields saves a copy of the table first.
- On History, Restore puts a saved version back. The table as it is now is saved first, so the restore can be undone from the same page. Restore asks for a short reason.
- Backups are listed at the bottom of History. Restoring a backup asks you to type `RESTORE`.

## If something looks wrong

- The top badge says History offline, or Database error: the table still loads, but saving waits or stops until the database responds. History offline clears by itself. Database error shows the reason in the table.
- The badge says API offline: the API window is closed or stopped. Start `start.bat` again.
- Saving stops with a message that someone else changed the same thing: reload the page and make the change again.

## For anyone who wants to try it

- Setup, database settings and the seed script are in `HANDOFF.md` and `docker_setup.md`.
- Changing the shape of the table needs a migration. Run `.\migrate.ps1 -Name YourChangeName` in `api_v2`, then restart the API.
- The API runs on http://localhost:5005 with Swagger at http://localhost:5005/swagger/index.html.
