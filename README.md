# About

This project is a small web app that shows a list of industries kept in a database. You can search the list, add new rows, edit them, and delete them, and everything you do on the page is saved to the database.

I started this on September 26, 2026, and the sections below show where things are and what comes next.

## Where things are

- Done: the list shows the data from the database, search works, and adding, editing, and deleting all save to the database.
- Done: the table has filters by sector and price, sorting on every column, pages, and Print and Export CSV.
- Done: the API applies database migrations by itself when it starts, retries when the database is slow to answer, and the page shows if the database is ready or broken.
- Done: a Python script fills the table with fake data for testing, see [Seeding synthetic data](#seeding-synthetic-data).
- Done: a name can only be used once, no matter the capitals or extra spaces, so `Atlas Steel` and `atlas steel ` count as the same company. The API checks it and the database has a rule for it too.
- Done: `start.bat` runs both folders at once.
- Done: the rules (name length, price range, what's required) live in the database with versions, and the page and the seed script read them from the API, see [Rules and the collector](#rules-and-the-collector).
- Done: before the table's structure or the rules change, a full copy goes to the `collector` database, and every add, edit, and delete gets logged there.
- Done: an optional Docker database for testing that starts empty, see [docker_setup.md](docker_setup.md). The API creates its databases by itself on the first run.
- Done: a History page to view, download, pin, restore, or bring back rows from any saved version, see [The pages](#the-pages).
- Done: a Fields page so the team adds fields and changes limits without touching C#.
- Done: a Requests page with a bell in the nav for anything that needs a developer, each one comes with the code drafted.
- Done: a break test, where we tried hard to break the app and fixed what broke. Two people saving at the same time don't overwrite each other anymore, names get cleaned before saving so lookalikes like `Atlas  Steel` with 2 spaces count as taken, CSV downloads can't run formulas in Excel, and errors come back as plain messages instead of empty 500s.
- Done: nightly backups of both databases, with a Back up now button on the History page, see [Backups](#backups).
- Done: sector is a dropdown now, and the choices come from `scripts/config.toml`, so nobody types it wrong and the API says no to anything else.
- Done: on Fields you can line up as many new fields as you want and send them in one go, and delete the ones made from the page.
- Done: login with usernames and passwords. Anyone can look at the table, an account is needed to change rows, and admins also get History, Fields and People, see [Accounts and sign in](#accounts-and-sign-in).
- Done: Export and Import settings on the History page, for how long old versions are kept and the field labels and limits.
- Done: the last break test findings. Restore is all or nothing, damaged saved versions are marked instead of breaking History, and saving retention first says how many versions it would remove.
- Done: the page checks its own input before anything is sent (the sign in back link, blocked storage, file names, the settings file, the people and account pages), with tests for each.
- Done: the UI judge's list. Problems sit under their own box, the phone nav has readable labels, long names end with ... on a phone, Delete names the row, every colour pair reads at 4.5:1 or better in light and dark, one focus ring for everything, and a loading line wherever a list was blank for a moment.
- Done: a Restore button on every backup. It puts the table, its rules, settings and requests back the way they were that night and leaves the accounts alone, see [Backups](#backups). Restores and imports of big tables got fast too, 100,000 rows in a few seconds instead of hitting the 30 second limit.
- Next: the open items listed at the bottom, see [Not done yet](#not-done-yet).

# Starting

- To start, go to `/angular` and run `npm install` to get the packages. Most likely there are 4 packages you'd forget, so do
`npm approve-scripts <package>`, which could look like this:
`npm approve-scripts @parcel/watcher`. That's an example.
That's all for Angular, as it's a bare project. When you create it, use `ssr=false`, and skip git with this flag:
`--skip-git`.

- For `api_v2`, it's a dotnet project, so you'd need to run `dotnet build`. It's a bit more non linear, as you'd need to get some packages. Make sure NuGet
as an extension is downloaded in VS Code. Also make sure `.NET Install Tool`, `C# Dev Kit`, and `C#` are all installed. Use this URL for the .NET installation,
no need for Visual Studio Community: https://dotnet.microsoft.com/en-us/download/dotnet/thank-you/sdk-10.0.401-windows-x64-installer.
For the packages, this project only uses the ones below. Don't change the versions, because a wrong version may break things, and whether it does depends on the version and your luck:

```
- https://www.nuget.org/packages/Swashbuckle.AspNetCore/10.0.0
- https://www.nuget.org/packages/Microsoft.EntityFrameworkCore.Design/10.0.12
- https://www.nuget.org/packages/Npgsql.EntityFrameworkCore.PostgreSQL/10.0.2
- https://www.nuget.org/packages/dotnet-ef/10.0.12
```

- For the database, you need Postgres. Docker is optional, if you want a test database that starts empty without touching your own Postgres, see [docker_setup.md](docker_setup.md).

- For the seed script in `scripts/`, you need Python 3.13 or newer. The command depends on how it's installed on your PC, it could be `python`, `py`, or `python3.13`. Run `python --version` or `py --version` to find yours, and use that one wherever the commands below say `python`. It only uses what comes with Python, so there's nothing to `pip install`.

And that should be all to get started.

## Running it

Double click `start.bat` in the project folder, or run `.\start.bat`. It starts the Docker database if the API uses it (no settings file, or settings pointing at port 5433), then opens 2 windows, one for the API at http://localhost:5005 and one for the page at http://localhost:4200. Closing a window stops that one. `.\start.bat https` does the same over https, see [Https](#https).

On a fresh clone the tables start empty, nobody's data comes with the repo. The API creates 2 databases on its first run: `main` with the `Industries` table and `collector`, which keeps the saved copies and the change log. If you want fake rows to test with, see [Seeding synthetic data](#seeding-synthetic-data).

If you want to do it by hand, open two terminals, one for each folder. If you use Docker, run `docker compose up -d` in the project folder first.

- In `api_v2`, run `dotnet run --launch-profile http`. The API starts at http://localhost:5005, and the Swagger page is at http://localhost:5005/swagger.
- In `angular`, run `ng serve`. The page opens at http://localhost:4200.

Start the API first. If the page says it could not load the industries, the API is most likely not running.

When the API starts, it checks the database and applies any migration that hasn't run yet. You can see how that went at http://localhost:5005/health, and the page shows the same thing as a small badge next to the table title:

- `Database ready`: all good.
- `Updating database`: migrations are running, or the database didn't answer and the API is retrying. It waits 2, 4, 8, then 16 seconds, and after that it keeps trying every 30 seconds until the database answers.
- `History offline`: the table still loads, but the `collector` isn't answering. You can read rows, but adding, editing, deleting, rule changes and the History page wait for it, since they all save a copy there first. Once it's back the badge goes away by itself.
- `Database error`: something failed that a retry won't fix, like a wrong password in the connection string or a broken migration. The error shows in the table so you know what to fix.
- `API offline`: the page can't reach the API at all.

One catch, if there's a migration waiting and the `collector` is down, the API holds off on migrating until it's back, so the copy always gets saved first.

## Angular

This folder uses Angular mainly to replace the Swagger UI from `api_v2/`. The 2 folders should not be merged, as they both handle different things: Angular handles project state, displaying the data safely, and a nice UI to handle everything more easily. The design is black and white and switches to dark mode with your system setting. Icons come from Font Awesome, loaded by the kit script in `src/index.html`.

### The pages

- Any page left alone for 5 minutes starts from the top when you come back to it (the tab becomes visible again, the window gets focus, or you click or type), in one jump, so nobody lands halfway down a table they don't remember scrolling. The time is `IdleAfterMs` in `angular/src/app/services/idle-top.ts`.
- **Sign in** (`/login`) and **Your account** (`/account`) are for changing your password or signing out. A new account has to pick its own password first. After a sign in the page goes back to where you were, as long as that's a page of this app.
- **People** (`/users`) is where an admin makes accounts, gives someone a new password, makes someone admin or normal, or turns an account off.
- **Industries** (`/`) is the table. Delete asks in the row, and afterwards says what went: "Deleted 1 row from Industries: Horizon Water LLC." Deleting a field on Fields says how many rows lost a value. Rows can have a triangle next to the name, hover it to see why:
  - red means a value couldn't come over from old data and shows `--`. It goes away once someone saves the row.
  - black is minor, like a value that breaks today's rules or a similar row.
  - Similar rows also get an amber background. That only happens through import, adding a name that's taken by hand still says it exists.
  - A wrench on a column header means a developer was asked about that column.
- **History** (`/history`) lists every saved copy of the table.
  - View and Download (opens in Excel).
  - Pin, so retention never removes it.
  - Restore swaps every row for that version's rows after you type `RESTORE`, and the table as it was gets saved first.
  - Bring back adds that version's rows as new rows with new numbers, nothing gets replaced. If the old data followed other rules it asks "The old data follows different rules than the table does now. Import it anyway?" first. Import without dups next to it skips every row whose name is already in the table, so you only get the ones that went missing.
  - Keep old versions sets how many to keep or after how many days to remove them. Empty means keep everything. Saving asks first when it would remove saved versions, and says how many.
  - Settings file: Export settings saves the retention and the field labels and limits to a file, Import settings loads one. It says what would change before it does anything, leaves out fields the table doesn't have, and saves a copy of the table first.
  - A saved version with a value that can't be read shows a Damaged tag and can't be restored or brought back.
  - Backups at the bottom: Back up now, a download for each one, and Restore, see [Backups](#backups).
- **Fields** (`/fields`) is where the team changes labels and limits, adds custom fields, and hides custom fields they don't want anymore. Hiding keeps the data. Every save is a new rules version and a copy of the table gets saved first. Changing a field's type or making it a real column goes to a developer from here. If someone else saved while you had the page open, your save gets stopped and asks you to reload, and what you typed stays there.
  - Add field puts the field in a list, nothing is saved yet. Add as many as you want, take one out with the x, then Send fields saves them all as one version.
  - Delete is on the fields made from the page, the built in ones (Name, Sector, Price, Release) live in code so they can't be deleted. It takes the values off every row, but a copy of the table is saved first so History can bring it back. Hide is still there if you only want it off the page.
- **Requests** (`/requests`) is for anything that needs a developer. The app makes some by itself, like when an import finds an old column that doesn't exist anymore or a restore brings back data from a different layout. Each one has the code drafted, Show the drafted code and Copy. The bell in the nav shows how many are open. Asking for something that's already open doesn't make a second one, your new details get added to the old one.

## Api_v2

This folder is a minimal web app API that has a direct line of communication with the database using **ConnectionString**, which is in `appsettings.Development.json`. That file is git ignored since it holds private details, so you won't find it in the repo.

You don't need it though. With no settings file, the API connects to the Docker database by itself. If you want your own Postgres instead, copy `appsettings.Development.example.json` to `appsettings.Development.json` and change the connection strings in it:

- `ApiV2` is the main database with the `Industries` table.
- `Collector` is where old versions go. Leave it out and the API uses the same server and login with a database called `collector`.

To wipe the Docker database and start empty again, run `docker compose down -v`.

### Rules and the collector

The limits for each field aren't in the code anymore, they're in the `RuleVersions` table. Every change makes a new version, so you can always see what the rules were before.

- `GET /schema` gives the rules in use. The page builds its rule chips and form checks from it.
- `PUT /schema` saves new rules as the next version, limits, labels, and hiding custom fields. It can't remove a field. Send `basedOn` with the version you started from and it says no if someone saved in between.
- `POST /schema/fields` adds a custom field, `POST /schema/fields/many` adds a whole list as one version. Their values live in the row's `Extra` column as JSON, so no migration is needed.
- `DELETE /schema/fields/{key}` deletes a custom field and its values, after saving a copy. A deleted field's key never gets used again, so old values can't come back on a new field.
- The sector choices come from `[fields] sectors` in `scripts/config.toml`. Change the list there and restart the API, it saves the new list as a rules version by itself.
- `GET /schema/versions` lists every rules version.

The `collector` database keeps old data so nothing gets lost:

- Before a migration runs on a database that already has data, the whole table gets copied there first. Same before new rules get saved. If that copy fails, the migration or the rules change doesn't happen.
- Every add, edit, and delete gets logged with the row before and after. None of them go through until the log is written, otherwise the API says so and nothing changes.
- Only retention deletes from the collector, the team sets it on the History page and it never touches pinned versions. Everything under `/history` is what that page uses.
- Old values that don't fit today's type become empty and the row remembers which ones in `LostFields`. `ImportedFrom` says which version a row came from, and `DuplicateOf` points an imported row at the row it's similar to.
- If an old column got renamed, add it to `ColumnRenames` in `History/TableWriter.cs` so imports bring it over. The app makes a request when that's needed. An old column that matches a custom field's name goes into that field by itself.

Requests live in the `Requests` table, `GET /requests` lists them and `GET /requests/count` is the bell. Settings like retention live in the `Settings` table, and `Collector:KeepVersions` and `Collector:KeepDays` in appsettings are the starting values.

### Accounts and sign in

Anyone can look at the table. Adding, editing and deleting rows needs an account, and History, Fields, People and backups need an admin. Requests are for anyone with an account, but only an admin can mark them done.

- The first start makes an account called `admin` with a random password and prints it once in the API window. Sign in with it and pick your own. If there's ever no working admin, the next start makes one again the same way.
- Forgot an admin password? Start the API with `Auth:ResetPassword` set to that username (for example `dotnet run --launch-profile http --Auth:ResetPassword=yahya`). It prints a new password once. Take the setting out again afterwards.
- Admins make the other accounts on the People page. Each gets a temporary password shown once, and has to pick their own at first sign in. Nobody can sign up by themselves, and accounts are turned off, never deleted, so History keeps the names.
- Passwords are at least 10 characters and are stored as a salted PBKDF2 hash, never as text. Signing in is limited to 5 tries a minute per address (`Auth:LoginTriesPerMinute`). A sign in lasts 12 hours after its last use, 7 days at most, and is kept in the browser.
- `Auth:GuestCanView` set to `false` hides the table from people who aren't signed in.
- On plain http anyone on the same Wi-Fi who is listening could read a password at sign in. On your own PC that's fine, on a shared network start with `start.bat https`, see [Https](#https). The API window says so at startup when nothing is https.
- The seed script needs an account now: set `SEED_USER` and `SEED_PASSWORD` before running it.
- Numbers have to arrive as numbers. The API refuses a price sent as text, like `"5"`.
- Restore from a backup on the History page leaves the accounts alone. Only a restore by hand with `pg_restore` of the whole database brings old accounts and passwords back.

### Https

`start.bat https` runs the API on https://localhost:7165 and the page on https://localhost:4200, and the page talks to the https API by itself (it picks the address from its own protocol, see `angular/src/environments/environment.ts`). Plain http on 5005 then answers with a redirect to https, and the API sends the HSTS header so browsers keep using https (not on localhost, ASP.NET leaves that one out on purpose).

Two things to do once:

- Make and trust the development certificate for the API: `dotnet dev-certs https --trust`. Windows asks once.
- The page's dev server makes its own certificate. The browser shows a warning the first time, accept it.

That certificate is only trusted on the PC that made it. Another PC on the Wi-Fi that opens the page gets a warning, which is the honest state of a self signed certificate. For a certificate everyone trusts, point Kestrel at it in `appsettings.Development.json`:

```
"Kestrel": {
  "Certificates": { "Default": { "Path": "C:\\certs\\stock-listing.pfx", "Password": "..." } }
}
```

By hand it's `dotnet run --launch-profile https --Https:Required=true` and `ng serve --ssl`. `Https:Required` is what turns the redirect and HSTS on, it's off by default so a fresh clone runs with no certificate. `Https:Port` is the port the redirect goes to, 7165 unless you change the profile. The page addresses the API accepts (`Cors:Origins` in `appsettings.json`) list both http and https for 4200.

The address the page uses for the API is in `angular/src/environments/environment.ts`. The page addresses the API accepts are `Cors:Origins` in `appsettings.json`.

### Backups

Every night at 2:00 AM the API saves a full copy of both databases with `pg_dump`, and keeps them for 14 days. The newest one never gets deleted, even if it's older than that. If the PC was off at 2:00, it makes one a few minutes after the API starts instead. On the History page there's a Back up now button and a list where you can download each one. Excel gives you the table as it was at that time, it opens straight in Excel. Main and History are the `.dump` files, those are what Restore reads.

They go in `backups/` in the project folder, which is git ignored. That's fine for mistakes, but if the disk dies the backups die with it, so point `Backup:Folder` in `appsettings.Development.json` at OneDrive or another drive. `Backup:Time` and `Backup:KeepDays` change the time and how long they stay.

It needs `pg_dump`, which comes with Postgres. The API finds it in `C:\Program Files\PostgreSQL` by itself, or you can set `Backup:PgDump` to its path.

Restore is next to each backup, for admins. After you type `RESTORE` it puts the table, its rules, how long old versions are kept, and the requests back the way they were in that backup. Accounts and sign ins are left as they are now, so nobody gets an old password back and nobody gets signed out. The table as it is now is saved to History first, so the restore itself can be undone from the same page.

How it works: the dump is loaded into a scratch database on the same server first, so a damaged file never touches the live one. Then the four tables are swapped in one transaction, either all of it goes in or nothing changes. It needs `pg_restore`, which sits next to `pg_dump`, and the API finds it the same way. A backup made when the table had other columns shows "Other table layout" and its Restore button is off, that one needs a developer.

The history database isn't restored from the page, it only ever grows and restoring it would throw away the versions saved since. If you ever need to, stop the API and run:

```
pg_restore --clean --if-exists --no-owner -h localhost -p 5432 -U postgres -d collector collector.dump
```

Use `-p 5433` if you're on Docker.

If the history database goes away while the API is running, the badge on the main page says History offline within half a minute, adding and editing rows stops with a plain message until it's back, and everything clears by itself once it answers again.

### Changing the table

If you change what a row holds, like adding a column, you change it in 3 places and the API handles the database part:

1. Update the C# model in `Model/Industry.cs` and the Dtos in `Dtos/` so they match. If the new column needs limits, add it to the rules in `Rules/FieldRule.cs` too.
2. In `api_v2`, run `.\migrate.ps1 -Name AddSomeColumn`. That creates the migration file from your model change.
3. Restart the API with `dotnet run --launch-profile http`. It applies the new migration on startup, so you don't run `dotnet ef database update` anymore.

Then update `angular/src/app/models/industry.ts` so the page knows about the new field. Adding, editing, and deleting rows never needs a migration, only changing the shape of the table does.

# Seeding synthetic data

`scripts/seed_industries.py` fills the table with fake companies so there's something to test with. Every row goes through the API like it would from the page, which means the API's rules decide what gets in. It also sends some broken rows on purpose (empty names, names that are too long, prices outside 0 to 10, names that already exist) to check that the API blocks them.

Start the API first, then from the project folder run:

```
python scripts/seed_industries.py
```

When it's done it prints how many rows got in, how many had no price or release, and how many broken rows got blocked. If a broken row ever gets in, it says so and exits with an error, because that means a rule has a hole.

## Using config.toml

Everything the script does is controlled from `scripts/config.toml`, so you don't touch the Python file. Open it, change a number, save, and run the script again. Each part is split by a comment that says what it's for:

- `[generation]` is the main one. `count` is how many rows you want in the database, so set it to `50` if you want 50. `bad_row_rate` is how many broken rows get mixed in, `0.10` means 10 for every 100, and `0` turns them off. `seed` gives you the same data every run if you set it to any number, `0` means random every time. `null_rate_min` and `null_rate_max` are how often price and release are left empty, right now that's somewhere between 5% and 7%.
- `[fields]` is what each value can be. The sectors list, the price range, how many decimals, the date range for release, and the longest name. The longest name, the price range and the sectors get replaced by the API's rules from `/schema` when the script runs, so they always match. The sectors list here is also what the API uses, so this is the place to change them.
- `[broken_rows]` is which rules to test. Remove one from the list and it stops sending that kind.
- `[names]` is the word lists the company names are built from. A name is one word from each list, like `Nizwa Retail Group`. Add your own words if you want different names.
- `[api]` is where the API is and how hard to push it. `workers` is how many rows get sent at the same time, and `max_retries` is how many times it tries again when the connection drops.

A few things to know when editing it:

- Comments start with `#`, not `//`. A `//` breaks the file.
- Dates go without quotes, like `release_from = 1995-01-01`.
- If you put something wrong, like `count = 0` or a price range where the min is above the max, the script lists every problem and sends nothing.

## Flags

Flags change one run without editing the file, and they win over what's in `config.toml`:

| Flag | What it does | Example |
|---|---|---|
| `--count` | How many rows to get in for this run | `--count 50` |
| `--seed` | Same number gives the same data every time | `--seed 7` |
| `--dry-run` | Prints sample rows and sends nothing, good for checking your config | `--dry-run` |
| `--config` | Use a different settings file | `--config scripts/big.toml` |

For example, to see what 50 rows would look like before sending anything:

```
python scripts/seed_industries.py --count 50 --dry-run
```

# Not done yet

- Restore brings back the rows and rules of a version but not its columns. If the table had different columns back then, a developer has to bring them back in code since the API moves the database forward on every start. The request it makes says how.
- Restore from a backup needs the backup to have today's table layout. One from before a database update shows "Other table layout" and needs a developer, the same as an old saved version.
- After the accounts update, every older saved version says "Different columns back then", and restoring one asks a developer about the layout. The accounts were added as new tables, the Industries table itself didn't change.
