# About

So this project is a small web app that shows a list of industries kept in a database. You can search the list, add new rows, edit them, and delete them, and everything you do on the page is saved to the database.

I have been working on this for 9 days so far, and the sections below show where things are and what comes next.

## Where things are

- Done: the list shows the data from the database, search works, and adding, editing, and deleting all save to the database.
- Done: the table has filters by sector and price, sorting on every column, pages, and Print and Export CSV.
- Done: the API applies database migrations by itself when it starts, retries when the database is slow to answer, and the page shows if the database is ready or broken.
- Done: a Python script fills the table with fake data for testing, see [Seeding synthetic data](#seeding-synthetic-data).
- Done: a name can only be used once, no matter the capitals or extra spaces, so `Atlas Steel` and `atlas steel ` count as the same company. The API checks it and the database has a rule for it too.
- Next: one script or build that runs both folders, and the edge cases listed at the bottom.

# Starting

- Well, to start things, first go to `/angular` and run `npm install` to get the packages. Most likely there are 4 packages you'd forget, so do
`npm approve-scripts <package>`, which could look like this:
`npm approve-scripts @parcel/watcher`. That's an example.
Anyway, that's all for Angular, as it's barebone. Pro tip: use `ssr=false`, as this project uses a barebone app, and preferably skip git by using this flag:
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

- For the seed script in `scripts/`, you need Python 3.13. I installed it from the Microsoft Store, so the command is `python3.13`. It only uses what comes with Python, so there's nothing to `pip install`.

And that should be all to get started.

## Running it

Open two terminals, one for each folder.

- In `api_v2`, run `dotnet run --launch-profile http`. The API starts at http://localhost:5005, and the Swagger page is at http://localhost:5005/swagger.
- In `angular`, run `ng serve`. The page opens at http://localhost:4200.

Start the API first. If the page says it could not load the industries, the API is most likely not running.

When the API starts, it checks the database and applies any migration that hasn't run yet. You can see how that went at http://localhost:5005/health, and the page shows the same thing as a small badge next to the table title:

- `Database ready`: all good.
- `Updating database`: migrations are running, or the database didn't answer and the API is retrying. It tries 5 times and waits longer each time (2, 4, 8, then 16 seconds).
- `Database error`: something failed that a retry won't fix, like a wrong password in the connection string or a broken migration. The error shows in the table so you know what to fix.
- `API offline`: the page can't reach the API at all.

Soon I'm planning to make a build to combine them both so no need to open 2 terminals or making a script in .bat (as I'm using windows for the build) to automate the runs.

## Angular

So this folder uses Angular mainly to replace the Swagger UI from `api_v2/`. The 2 folders should not be merged, as they both handle different things: Angular handles project state, displaying the data safely, and a nice UI to handle everything more easily. The design is black and white and switches to dark mode with your system setting. Icons come from Font Awesome, loaded by the kit script in `src/index.html`.

## Api_v2

So this folder is a minimal web app API that has a direct line of communication with the database using **ConnectionString**, which is in `appsettings.Development.json`. Don't waste your time looking for it, I intentionally git ignored it since it holds private details. Well, I thought of giving dummy `.json` files so the setup would be easier and faster, but I left it out on purpose, so ask me and I'll share it.

### Changing the table

If you change what a row holds, like adding a column, you change it in 3 places and the API handles the database part:

1. Update the C# model in `Model/Industry.cs` and the Dtos in `Dtos/` so they match.
2. In `api_v2`, run `.\migrate.ps1 -Name AddSomeColumn`. That creates the migration file from your model change.
3. Restart the API with `dotnet run --launch-profile http`. It applies the new migration on startup, so you don't run `dotnet ef database update` anymore.

Then update `angular/src/app/models/industry.ts` so the page knows about the new field. Adding, editing, and deleting rows never needs a migration, only changing the shape of the table does.

# Seeding synthetic data

So `scripts/seed_industries.py` fills the table with fake companies so there's something to test with. Every row goes through the API like it would from the page, which means the rules in `api_v2/Dtos` decide what gets in. It also sends some broken rows on purpose (empty names, names that are too long, prices outside 0 to 10, names that already exist) to check that the API blocks them.

Start the API first, then from the project folder run:

```
Install python3.13 or a compatiable version
scripts/seed_industries.py
```

When it's done it prints how many rows got in, how many had no price or release, and how many broken rows got blocked. If a broken row ever gets in, it says so and exits with an error, because that means a rule has a hole.

## Using config.toml

Well, everything the script does is controlled from `scripts/config.toml`, so you don't touch the Python file. Open it, change a number, save, and run the script again. Each part is split by a comment that says what it's for:

- `[generation]` is the main one. `count` is how many rows you want in the database, so set it to `50` if you want 50. `bad_row_rate` is how many broken rows get mixed in, `0.10` means 10 for every 100, and `0` turns them off. `seed` gives you the same data every run if you set it to any number, `0` means random every time. `null_rate_min` and `null_rate_max` are how often price and release are left empty, right now that's somewhere between 5% and 7%.
- `[fields]` is what each value can be. The sectors list, the price range, how many decimals, the date range for release, and the longest name. Keep these inside the API rules, otherwise the API rejects the good rows too and the script will tell you.
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

- One script or build that starts the API and the page together, right now it's still 2 terminals.
- The API address `http://localhost:5005` is written straight into `angular/src/app/services/industry-api.ts` and the CORS setup in `Program.cs`, so it only works on this machine until it moves to a config.
- Delete still uses the browser's own "are you sure" popup instead of one that matches the design.
