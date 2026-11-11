# Stock Listing

A page for the industries list. The team can look at the table and change it from the frontend, so the list stays something they can work on together.

## How to start it

1. Double click `start.bat` in the project folder.
2. Two windows open. Leave both of them open while you work.
3. Open http://localhost:4200. If that port is busy, press `y` in the Angular window (`ng serve`) and it picks another one.

Closing a window stops that part. If you only want the API, leave the backend window open and use Swagger at `/swagger` (the full page is `/swagger/index`). When the page says it could not load the industries, the API window is closed or the API has stopped. The frontend can be down. The API cannot.

Other ways to start:

- `start.bat https` runs the page over https on this PC.
- `start.bat share` opens the page to phones and other PCs on the same Wi-Fi. The first time, other devices show a certificate warning. Continue past it.

## Signing in

The first start creates an admin account called `admin` with a random password. The password is printed once in the API window, so copy it then. Sign in and choose a new password.

If that password is lost, run `dotnet --Auth:ResetPassword='user'`. You get a temporary password. Take it to the login page, then set a new one.

An admin creates accounts in Settings and hands each person their username and temporary password. They sign in and set their own password.

Sign in attempts are limited. One address gets 5 attempts a minute (`Auth:LoginTriesPerMinute`). One username gets 10 wrong passwords in 15 minutes from anywhere (`Auth:FailedTriesPerName`, `Auth:FailedTriesWindowMinutes`). Past either limit, the page says how long to wait and keeps Sign in off until then. A correct password clears that username's count.

There are three roles. A **user** can add, edit, and delete rows. A **manager** can also make, change, and delete tables on the Tables page, and take, download, drop in, and restore backups. An **admin** can do everything, including rules, History versions, and Settings.

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
| Fields | `/fields` | Admin | Labels, limits, and custom fields |
| Tables | `/tables` | Signed in to look, manager or admin to change | Tables the team makes itself |
| Requests | `/requests` | Signed in | Work that needs a developer |

The old `/users` address opens Settings. Every page jumps back to the top after 5 minutes without activity.

## Saving and undoing changes

- Adding, editing, and deleting rows is saved right away. Each delete shows exactly what would be deleted and waits for you to approve it.
- Every change to the fields saves a copy of the table first.
- On History, Restore puts a saved version back. The table as it is now is saved first, so you can undo the restore from the same page. Restore asks for a short reason.
- Backups are listed at the bottom of History. Restoring a backup asks you to type `RESTORE`. It brings back the industries, their rules, requests, settings, and every table from the Tables page. A full backup of right now is taken first, so you can undo by restoring that one.
- The only backup file you can drop in is a `.zip`. Drop it on the box on History to put it back in the list. Only a zip from this computer is accepted, so a backup made on another machine does not get mixed in.
- Backups belong to the computer that made them. Their files are encrypted with a key in `backup-key/`, and Windows wraps that key for this computer. Copy the folder to another PC and its backups cannot be opened, restored, or downloaded there. The same goes for a backup zip. If this PC is reinstalled or Windows is reset, the key cannot be unwrapped and those backups are lost, so keep the database itself backed up somewhere else too. Keep `backup-key/` out of any copy you make of the project.
- Deleting a table on the Tables page puts it in the bin for 14 days. **Bring back** returns it with its rows.

## If something looks wrong

- API offline or a database error shows up across the page. When the database is the problem, the table still loads, but saving waits or stops until the database responds. History offline clears by itself. A database error shows the reason in the table.
- When the badge says API offline, the API window is closed or stopped. If the frontend is still running, open a terminal, `cd angular`, and run `ng serve`. On a first run, `ng build` builds the services and components. If both windows are down, run `start.bat` again.
- If saving stops because someone else changed the same thing, reload the page and check whether their save went in. If it did not, add it again.

## For anyone who wants to try it

Setup, database settings, and the seed script are in `scripts/`. Copy `seeding.control.example.toml`, put the admin username and password in it, and control the script from `seeding.toml`. Docker notes are in `docker_setup.md`.

Changing the shape of a table needs a migration, in one of two chains. The data chain is what a restore can roll back: the industries, their rules, and the Tables page. From `api_v2`, that is `.\migrate.ps1 -Context Data -Name YourChangeName`. Accounts, notes, the Scratchpad, requests, and settings stay current and have their own chain (`-Context State`), so rolling the data back leaves them alone. Restart the API and it applies both.

The API runs on http://localhost:5005. Swagger is at http://localhost:5005/swagger/index.html.
