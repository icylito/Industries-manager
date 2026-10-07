# Docker setup

This is not mandatory. If you already have Postgres installed and your `appsettings.Development.json` points at it, you can skip this whole file.

Docker is just an easy way to get a test database that starts empty, without touching your own Postgres. If you'd like to test with it, do the steps below.

## Passwords

- Your own Postgres (port `5432`): use your own postgres password, the one you set when you installed it.
- The Docker one (port `5433`): the password is `postgres`. That's fine here since it only runs on your PC for testing.

## 1. Start the database

Install Docker Desktop, open it, then from the project folder run:

```
docker compose up -d
```

Check it's running, you should see `stock-listing-db` with `5433->5432`:

```
docker ps
```

To see all the running docker processes

## 2. Run the API against it

From `api_v2`, in PowerShell:

```
$env:ConnectionStrings__ApiV2="Host=localhost;Port=5433;Database=main;Username=postgres;Password=postgres"
dotnet run --launch-profile http
```

This only lasts for that terminal, so your own `appsettings.Development.json` stays the same. If you don't have that file at all, skip the first line, the API uses Docker by itself.

On the first run the API creates 2 databases, `main` with the `Industries` table, and `collector`. Both start empty. To get fake rows in, run `python scripts/seed_industries.py` from the project folder (or `py`, check with `python --version`) while the API is running. The account is `username` and `password` in `scripts/seeding.control.toml` (copy `seeding.control.example.toml`). Row counts and names stay in `seeding.toml`.

## 3. See it in pgAdmin (optional)

Servers → Register → Server, then in the Connection tab:

| Field | Value |
|---|---|
| Host | `localhost` |
| Port | `5433` |
| Username | `postgres` |
| Password | `postgres` |

Make sure the port is `5433`. If it says `5432` you're connecting to your own Postgres and the `postgres` password won't work there.

## Stop or reset

```
docker compose stop       # stops it, keeps the data
docker compose start      # starts it again
docker compose down -v    # deletes it and all its data, next start is empty
```
