# Stock Listing

A web page for the industries list. It shows the table, lets people change it from the frontend to help make the team interactive with the build however they like.


## How to start it

1. Double click `start.bat` in the project folder.
2. Two windows open. Keep them open while you work.
3. Open http://localhost:4200 or create a new port if its busy by simply pressing `y` in the angular terminal which may be written as `ng serve` in your terminal.

Closing a window stops it from working if you just want the api without frontend you could use swagger by keeping the backend alive and doing `/swagger` if needed `/swagger/index`. If the page says it could not load the industries, the API window is closed make sure api is working the frotend is optional the api isn't.

Other ways to start:
- `start.bat https` runs the page over https on this PC.
- `start.bat share` opens the page to phones and other PCs on the same Wi-Fi. The first time, other devices show a certificate warning. Continue past it.

## Signing in

The first start creates an admin account called `admin` with a random password. The password is printed once in the API window, so copy it then. Sign in and choose a new password.

If the admin password is lost, or if you're brave enough do `dotnet --Auth:ResetPassword='user'` and you'll get a temp password copy it and take it to the login page password and then make a new password then you're all set.

The admin create the account in Settings, then hands it to the user the admin wants to have that account after that the user signs in with his made username and temp password, then creates a new password.

Guessing is rated limited per ip. One address gets 5 attempts a minute (`Auth:LoginTriesPerMinute`), and one username gets 10 wrong passwords in 15 minutes from anywhere (`Auth:FailedTriesPerName`, `Auth:FailedTriesWindowMinutes`). Past either, the page says how long to wait and keeps Sign in off until then. A right password clears the username's count.

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

- Adding, editing and deleting rows is saved right away. Each delete shows exactly what would be deleted in a pop up which requires you're approval.
- Every change to the fields saves a copy of the table first.
- On History, Restore puts a saved version back. The table as it is now is saved first, so the restore can be undone from the same page. Restore asks for a short reason.
- Backups are listed at the bottom of History. Restoring a backup asks you to type `RESTORE`. It brings back the industries, their rules, requests, settings and every table from the Tables page. A full backup of right now is taken first, so a restore can be undone by restoring that one.
- Regarding the backups the only supported format is `.zip`, and drop that zip on the box on History to put it back in the list. Only a local zip file is accepted as of now to minimize migration issues from different devices hosting the API.
- Backups belong to the computer that made them. Their files are encrypted with a key in `backup-key/`, and that key is wrapped by Windows for this computer. Copy the folder to another PC and its backups can't be opened, restored or downloaded there. The same goes for a backup zip. If this PC is reinstalled or Windows is reset, the key can't be unwrapped and those backups are lost, so keep the database itself backed up somewhere else too. Keep `backup-key/` out of any copy you make of the project.
- Deleting a table on the Tables page puts it in the bin for 14 days. **Bring back** returns it with its rows immediately.

## If something looks wrong

- Most likely the API is down offline which the state management will immediately show everywhere, or Database error: the table still loads, but saving waits or stops until the database responds. History offline clears by itself. Database error shows the reason in the table.
- The badge says API offline: the API window is closed or stopped. If frontend is running open a terminal cd into angular `cd angular` and then run `ng serve` if its your first run do `ng build` to build all the services and components if both terminals are off or down run `start.bat` again.
- Saving stops with a message that someone else did the change: reload the page and verify if the other save went in if not add it manually.

## For anyone who wants to try it

- Setup, database settings and the seed script which are all in `scripts/` in the scripts folder there is `seeding.control.example.toml` drop the admin username and password there and control the script in `seeding.toml` to setup a safe environment you'll find docker docs if you're interested `docker_setup.md`.
- Changing the shape of a table needs a migration, in one of two chains. Only the data travels in time: the industries, their rules and the Tables page are the data chain (`.\migrate.ps1 -Context Data -Name YourChangeName` in `api_v2`). Accounts, notes, the Scratchpad, requests and settings are always current and have their own chain (`-Context State`), so going back on the data never touches them. Restart the API and it applies both.
- The API runs on http://localhost:5005 with Swagger at http://localhost:5005/swagger/index.html.
