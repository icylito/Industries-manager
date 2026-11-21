# Docker setup

You don't need this if you already have Postgres 17 installed and `api_v2/appsettings.Development.json` points at it.

Docker gives you a database that starts empty and stays out of the way of your own Postgres. `start.bat` starts it for you, so most of the time you won't have to touch it. This page is for when you want to look inside it or start over.

## Which password goes where

- Your own Postgres, on port `5432`: the password you set when you installed it.
- The Docker one, on port `5433`: `postgres`. That's fine here, because it only listens on your PC.

## Start the database

Install Docker Desktop, open it, then from the project folder:

```bat
docker compose up -d
docker ps
```

You should see `stock-listing-db` with `5433->5432` in the list.

## Point the API at it

`appsettings.Development.example.json` already points at the Docker database. If you don't have `api_v2/appsettings.Development.json` at all, the API uses Docker by itself, so `dotnet run --launch-profile http` from `api_v2` is all you need.

If your settings file points at your own Postgres and you want to try Docker for one run, set the connection for that terminal only. In PowerShell, from `api_v2`:

```powershell
$env:ConnectionStrings__ApiV2="Host=localhost;Port=5433;Database=main;Username=postgres;Password=postgres"
dotnet run --launch-profile http
```

Your settings file stays as it was. To switch for good, change both connection strings in it to the port and password you want. Git ignores that file, so the change stays on your PC.

On its first run the API makes two databases, `main` with the industries and `collector` for History, and both start empty. To fill the table, copy `scripts/seeding.control.example.toml` to `scripts/seeding.control.toml`, put the admin login in it, and run `python scripts/seed_industries.py` while the API is running. How many rows and what they're called is set in `scripts/seeding.toml`.

## Look inside with pgAdmin

Servers, Register, Server, then in the Connection tab:

| Field | Value |
|---|---|
| Host | `localhost` |
| Port | `5433` |
| Username | `postgres` |
| Password | `postgres` |

Check the port. If it says `5432` you're connecting to your own Postgres, and the `postgres` password won't work there.

## Stop or start over

| Command | What it does |
|---|---|
| `docker compose stop` | Stops it and keeps the data |
| `docker compose start` | Starts it again |
| `docker compose down -v` | Deletes it and all its data, so the next start is empty |
