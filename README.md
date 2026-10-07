# Stock Listing

An Angular 22 page over a .NET 10 minimal API and PostgreSQL. It lists industries and keeps every change.

- Anyone can browse the table. An account is needed to change rows, and an admin gets the extra pages.
- Every add, edit and delete is logged, and every change to the table's shape or rules saves a full copy into a second database called `collector`.
- Setup history is in `HANDOFF.md`, work notes in `report.txt`.
- Files under `angular/src` use CRLF line endings, and so does this file.

## Running it

Double click `start.bat`, or run `.\start.bat`. It opens two windows: the page on http://localhost:4200 and the API on http://localhost:5005. Closing a window stops that part. `start.bat https` runs both over https ([Https](#https)), and `start.bat share` opens the page to a phone or another PC on the same Wi-Fi ([Sharing on the Wi-Fi](#sharing-on-the-wi-fi)).

By hand, in two terminals: `dotnet run --launch-profile http` in `api_v2` (Swagger at http://localhost:5005/swagger/index.html), and `npx ng serve` in `angular`. Start the API first; if the page says it could not load the industries, the API is most likely not running.

A fresh clone starts empty. The API creates two databases on its first start, `main` with the `Industries` table and `collector`, and applies any waiting migration then. The page carries a badge next to the table title, from http://localhost:5005/health:

| Badge | Meaning |
|---|---|
| Connected | All good |
| Updating database | Migrations are running, or the database hasn't answered yet. It retries after 2, 4, 8 and 16 seconds, then every 30 seconds |
| History offline | The table still loads, but `collector` isn't answering, so saving, rule changes and History wait. It clears by itself |
| Database error | Something a retry won't fix, like a wrong password. The reason shows in the table |
| API offline | The page can't reach the API at all |

A waiting migration holds off while `collector` is down, so the copy always gets saved before the database changes.

## Where things are

| Folder | What it holds |
|---|---|
| `angular/` | The page: project state, displaying the data safely, replacing the Swagger UI |
| `api_v2/` | The API: endpoints, rules, history, backups, accounts |
| `scripts/` | The seed script and its two settings files |
| `design/` | The design the Overview follows, and the Scratchpad design |
| `testing/` | The check suites, kept out of the app |
| `backups/` | Nightly database copies, git ignored |
| `start.bat` | Starts both halves |

Files worth knowing: `api_v2/Program.cs` (routes, `GET /health`), `Model/Industry.cs` (what a row holds), `Rules/FieldRule.cs` (the built in limits), `History/TableWriter.cs` (reading old rows back, and `ColumnRenames`), `Backups/BackupService.cs` (`pg_dump` and retention), `angular/src/app/app.routes.ts` (every page and who may open it), `app.html` (both navs), `Components/my-components/my-components.ts` (Browse), `Components/overview/overview-data.ts` (every overview number), `services/idle-top.ts` (the 5 minute jump to the top), `environments/environment.ts` (the API address).

## First setup

| Tool | Notes |
|---|---|
| Node and npm | In `angular/`, run `npm install`. npm may ask you to approve build scripts: `npm approve-scripts @parcel/watcher` |
| .NET 10 SDK | [sdk-10.0.401-windows-x64-installer](https://dotnet.microsoft.com/en-us/download/dotnet/thank-you/sdk-10.0.401-windows-x64-installer), and the NuGet packages listed in `api_v2.csproj`: Swashbuckle 10.0.0, EntityFrameworkCore.Design 10.0.12, Npgsql 10.0.2, plus dotnet-ef 10.0.12 for `migrate.ps1`. Don't change the versions |
| VS Code | `C#`, `C# Dev Kit`, `.NET Install Tool`, and NuGet |
| PostgreSQL | Your own install. Docker is optional, see [docker_setup.md](docker_setup.md) |
| Python | 3.13, only for the seed script. No `pip install`; your command may be `python`, `py` or `python3.13` |

## Settings and the database

`appsettings.Development.json` holds the two connection strings and is git ignored. Copy `appsettings.Development.example.json` to make your own. `ApiV2` is the live database with the `Industries` table; `Collector` is where the saved copies and the change log go, and leaving it out means the same server and login with a database called `collector`.

The installed setup uses your own PostgreSQL 18 on port 5432, with the databases `main` and `collector`. `docker-compose.yml` is a test database on 5433 that starts empty, covered in [docker_setup.md](docker_setup.md).

The field limits aren't in the code, they're in the `RuleVersions` table, and every save is a new version.

- `GET /schema` gives the rules in use, which the page builds its form checks from. `PUT /schema` saves new ones and is refused if someone saved in between.
- `POST /schema/fields` and `/schema/fields/many` add custom fields, whose values live in the row's `Extra` column as JSON, so no migration is needed. `DELETE /schema/fields/{key}` removes one and its values after saving a copy, and that key never gets used again.
- The sector choices come from `[fields] sectors` in `scripts/config.toml`, so change the list there and restart the API.
- Values that don't fit today's type become empty, and the row remembers which in `LostFields`.

Changing the shape of the table, and nothing else, needs a migration: change the model in `Model/Industry.cs` and the Dtos in `Dtos/`, run `.\migrate.ps1 -Name AddSomeColumn` in `api_v2`, then restart the API, which applies it on startup. There's no `dotnet ef database update`. Finally, update `angular/src/app/models/industry.ts`. Adding, editing and deleting rows never needs any of this.

## The pages

| Page | Address | Who | What it is |
|---|---|---|---|
| Browse | `/` | Anyone | The table |
| Sign in | `/login` | Anyone | Signing in |
| Your account | `/account` | Signed in | Your password, and signing out |
| Overview | `/overview` | Admin | The table at a glance, slim nav |
| Settings | `/settings` | Admin | Your account and the people who can sign in, slim nav |
| History | `/history` | Admin | Every saved copy, normal nav |
| Fields | `/fields` | Admin | Labels and limits, normal nav |
| Requests | `/requests` | Signed in | Anything that needs a developer |

An old `/users` link lands on Settings. Every page jumps back to the top after 5 minutes of nobody touching it.

- **Browse** is the table: search, filters by sector and price, sorting on every column, pages, Print and Export CSV. Delete names what went, like "Deleted 1 row from Industries: Horizon Water LLC." A name has to be unique ignoring capitals and extra spaces, and the API and the database both enforce it. A triangle next to a name is something to look at: red is a value that couldn't come over from old data, shown as `--` until someone saves the row, and black is minor, with an amber background on similar rows. It also reads filters from the address, which is how the Overview opens it: `/?sector=`, `/?minPrice=&maxPrice=`, `/?releaseFrom=&releaseTo=`, `/?flags=duplicate,lost,noprice,nodate`, `/?q=` and `/?edit=12`.
- **Overview** is the table at a glance, for spotting, where Browse is for acting. A circle splits the industries by sector, price band, release era or a custom field with a list of choices, and one selection drives every bar and number. Compare sets two slices side by side, Open N in Browse carries the same rows across when Browse can show them, and the theme button and the Shortcuts panel are both kept in this browser.
- **History** lists every saved copy: View, Download (a CSV that opens in Excel) and Pin, so retention never removes it. Restore replaces every row with that version's rows, asking first for a few words about why, at least 10 characters, which it keeps with the copy of the table it saves first. Bring back adds those rows as new rows with new numbers instead, and Import without dups skips names already in the table. Keep old versions sets how many to keep or after how many days to remove them, empty keeps everything, and saving says how many it would remove. Export and Import settings move the retention and the field labels and limits to a file, saying what would change first. A saved version with a value that can't be read shows a Damaged tag, and the backups sit at the bottom, see [Backups](#backups).
- **Fields** is where the team changes labels and limits, adds custom fields, and hides or deletes custom fields; hiding keeps the data. Every save is a new rules version and saves a copy of the table first. Send fields saves every field you added as one version, Delete is only offered on the fields made from the page, and a new type or a field that becomes a real column goes to a developer. If someone else saved while you had the page open, your save is stopped and asks you to reload.
- **Requests** is for anything that needs a developer. The app makes some by itself, like an import finding a column that no longer exists, and each has code drafted, with Show the drafted code and Copy. The bell shows how many are open, and asking for something already open adds your details to it instead.

## Settings, accounts and sign in

Settings is for admins: your own account and password, then the people who can sign in. From there an admin makes an account, changes a username, gives someone a new password, makes someone admin or normal, turns an account off, keeps a note that only admins ever see, or deletes an account for good.

- Deleting an account is a hard delete. It refuses to delete you, and refuses to remove the last enabled admin. History keeps the old username, so old entries still read right.
- The first start makes an account called `admin` with a random password, printed once in the API window. For a forgotten password, start with `Auth:ResetPassword` set to that username, then take the setting out again.
- Nobody can sign up by themselves. A new account gets a temporary password shown once and has to pick its own at first sign in.
- Passwords are at least 10 characters and stored as a salted PBKDF2 hash, never as text. Signing in allows 5 tries a minute per address, and a sign in lasts 12 hours after its last use and 7 days at most (`Auth:LoginTriesPerMinute`, `Auth:GuestCanView`).
- On plain http anyone on the same Wi-Fi who is listening could read a password at sign in; on a shared network use `start.bat https` or `start.bat share`.

## Seeding synthetic data

`scripts/seed_industries.py` fills the table with fake companies. Every row goes through the API, so the API's rules decide what gets in, and it also sends broken rows on purpose to check that they're refused. Start the API first, then from the project folder:

```
python scripts/seed_industries.py
```

It signs in with the `username` and `password` from `scripts/seeding.control.toml`, so first copy `scripts/seeding.control.example.toml` to that name and fill it in (the copy is git ignored, and `SEED_USER` and `SEED_PASSWORD` also work). It reports how many rows were added, kept or refused, and exits with an error if one breaks a rule. The settings are split over two files in `scripts/`:

- `config.toml` is what the table's values can be, in `[fields]`: the sectors list, the price range, how many decimals, the release date range and the longest name. The API reads the sectors list from here too.
- `seeding.toml` is only for the seed script. `[generation]` holds `count`, `bad_row_rate` (0 turns broken rows off), `seed` (the same number gives the same data every run, 0 is random) and `null_rate_min` and `null_rate_max` for how often price and release are left empty. `[broken_rows]` is which rules to test, `[names]` the words names are built from, and `[api]` where the API is and how hard to push it.
- Comments start with `#`, not `//`, dates go without quotes, and a value that doesn't make sense makes the script send nothing.

Flags change one run without editing the files, and win over what's in them:

| Flag | What it does | Example |
|---|---|---|
| `--count` | How many rows to get in for this run | `--count 50` |
| `--seed` | Same number gives the same data every time | `--seed 7` |
| `--dry-run` | Prints sample rows and sends nothing | `--dry-run` |
| `--config` | Use a different main config | `--config scripts/other.toml` |
| `--seeding` | Use a different seed settings file | `--seeding scripts/big.toml` |

## Backups

Every night at 2:00 the API saves a full copy of both databases with `pg_dump` and keeps them for 14 days; the newest never gets deleted, and if the PC was off at 2:00 it makes one shortly after the API starts. The History page has Back up now, a download for each copy, and Restore next to each one.

- A restore puts the table, its rules, the retention and the requests back the way they were in that backup, and leaves the accounts and sign ins alone. The table as it is now goes to History first, so it can be undone from the same page.
- Restoring a backup still asks you to type `RESTORE`. That's the Backups card, and it hasn't changed.
- The dump is loaded into a scratch database first, so a damaged file never touches the live one, then the tables are swapped in one transaction. A backup from a different table layout needs a developer.
- The copies go in `backups/`, which is git ignored and on the same disk, so point `Backup:Folder` in `appsettings.Development.json` elsewhere if that matters. `Backup:Time`, `Backup:KeepDays` and `Backup:PgDump` change the time, how long they stay, and where `pg_dump` is found.

If the history database goes away while the API is running, the badge says History offline within half a minute and saving stops with a plain message until it's back.

## Https

`start.bat https` runs the API on https://localhost:7165 and the page on https://localhost:4200, and the page picks the https API by itself. Plain http on 5005 then redirects to https, and the API sends the HSTS header. `Https:Required` turns both on, and it's off by default so a fresh clone runs with no certificate. Make and trust the certificate once with `dotnet dev-certs https --trust`; `start.bat` copies it to `angular/.cert` (git ignored) the first time, so this PC opens both pages with no warning.

That certificate is trusted only on the PC that made it, and only for `localhost`, so another PC gets a warning. For one everyone trusts, point Kestrel at it in `appsettings.Development.json`:

```
"Kestrel": {
  "Certificates": { "Default": { "Path": "C:\\certs\\stock-listing.pfx", "Password": "..." } }
}
```

By hand: `dotnet run --launch-profile https --Https:Required=true` and `npx ng serve --ssl --ssl-cert .cert/localhost.pem --ssl-key .cert/localhost.key`. The addresses the page is served from are `Cors:Origins` in `appsettings.json`.

## Sharing on the Wi-Fi

`start.bat share` opens the page to other devices on the same network, over https, and the window prints the address, for example `https://192.168.1.45:4200`. Only the page is open; the API and the database stay on this PC, and the page server passes `/api` on to the API (`angular/proxy.share.json`). The other device shows a certificate warning the first time, because the certificate is for `localhost` and not this PC's address.

- Windows asks about the firewall the first time Node listens on the network; allow private networks, and make sure that Wi-Fi network is set to Private in Windows Settings.
- `start.bat share db` also opens the database to the network on 5433, user and password `postgres`. Anyone on the Wi-Fi can then reach every table without signing in, so only do it on a network you trust, and go back to plain `start.bat` after.

## Not done yet

- Restore brings back a version's rows and rules but not its old columns. If the table had different columns back then a developer has to bring them back in code, and the app makes a request that says how.
- A restore from a backup, or of a saved version, from before a table change needs a developer. The accounts update added new tables without changing the `Industries` table.
- The Scratchpad isn't built. Its design is in `design/` and the brief for building it is in `HANDOFF.md`.
