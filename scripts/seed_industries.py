import argparse
import json
import os
import random
import re
import sys
import threading
import time
import tomllib
import unicodedata
import urllib.error
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path

DEFAULT_CONFIG = Path(__file__).with_name("config.toml")    # the main config, what the values can be
DEFAULT_SEEDING = Path(__file__).with_name("seeding.toml")  # how the seed script makes and sends rows
CONTROL_FILE = Path(__file__).with_name("seeding.control.toml")  # local account, git ignores it
BAD_ROW_KINDS = {"name_too_long", "empty_name", "price_out_of_range", "duplicate_name"}
SIGN_IN_MISSING = (
    "The API needs a sign in. Copy scripts/seeding.control.example.toml to "
    "scripts/seeding.control.toml and fill in username and password "
    "(an account from the People page), or set SEED_USER and SEED_PASSWORD, and run again"
)


def control_text(value: object, key: str) -> str:
    # A missing value falls through. A number or a list is a broken file, so stop before any row is sent.
    if value is None:
        return ""
    if not isinstance(value, str):
        sys.exit(f"seeding.control.toml {key} must be text")
    return value


def resolve_login(
    file_user: object,
    file_password: object,
    env_user: str | None,
    env_password: str | None,
) -> tuple[str, str]:
    # A filled field in the control file wins, so a leftover variable in the window cannot replace it.
    # The username is stripped. The password is not, so a space in it survives.
    user = control_text(file_user, "username").strip() or (env_user or "").strip()
    password = control_text(file_password, "password") or (env_password or "")
    return user, password


def load_control_account() -> tuple[object, object]:
    # Missing file means no account here. read_toml would exit, and the env variables can still fill in.
    if not CONTROL_FILE.exists():
        return "", ""
    data = read_toml(CONTROL_FILE)
    return data.get("username", ""), data.get("password", "")


def read_toml(path: Path) -> dict:
    try:
        # utf-8-sig drops the BOM that some Windows editors add, tomllib rejects it otherwise
        return tomllib.loads(path.read_text(encoding="utf-8-sig"))
    except FileNotFoundError:
        sys.exit(f"Config file not found: {path}")
    except tomllib.TOMLDecodeError as e:
        sys.exit(f"Config file {path} is not valid TOML: {e}")


def load_config(path: Path, seeding_path: Path) -> dict:
    # [fields] comes from the main config, everything else from seeding.toml
    main, seeding = read_toml(path), read_toml(seeding_path)
    if "fields" not in main:
        sys.exit(f"Config file {path} is missing the [fields] section")
    config = {**seeding, "fields": main["fields"]}

    # Catch bad values here with a clear message, before any row is sent
    try:
        g, f, b, n, a = (config[k] for k in ("generation", "fields", "broken_rows", "names", "api"))
        problems = []
        if g["count"] < 1:
            problems.append("generation.count must be 1 or more")
        if not 0 <= g["bad_row_rate"] <= 1:
            problems.append("generation.bad_row_rate must be between 0 and 1")
        if not 0 <= g["null_rate_min"] <= g["null_rate_max"] <= 1:
            problems.append("generation.null_rate_min and null_rate_max must be between 0 and 1, min first")
        if not f["sectors"]:
            problems.append("fields.sectors needs at least one sector")
        if f["price_min"] > f["price_max"]:
            problems.append("fields.price_min must not be above fields.price_max")
        if not isinstance(f["release_from"], date) or not isinstance(f["release_to"], date):
            problems.append("fields.release_from and release_to must be dates like 2026-09-30, no quotes")
        elif f["release_from"] > f["release_to"]:
            problems.append("fields.release_from must not be after fields.release_to")
        if unknown := set(b["kinds"]) - BAD_ROW_KINDS:
            problems.append(f"broken_rows.kinds has unknown kinds {sorted(unknown)}, allowed: {sorted(BAD_ROW_KINDS)}")
        if not n["prefixes"] or not n["cores"] or not n["suffixes"]:
            problems.append("names.prefixes, cores, and suffixes each need at least one entry")
        if a["workers"] < 1:
            problems.append("api.workers must be 1 or more")
    except KeyError as e:
        sys.exit(f"The setting {e} is missing, [fields] goes in {path.name} and the rest in {seeding_path.name}")
    if problems:
        sys.exit("Config problems:\n  " + "\n  ".join(problems))
    return config


def stored_name(name: str | None) -> str:
    # Same cleanup as Names.Clean: the length the API stores, not the text that was sent.
    if not name:
        return ""
    normalized = unicodedata.normalize("NFKC", name)
    chars: list[str] = []
    for ch in normalized:
        if ch.isspace():
            chars.append(" ")
            continue
        if unicodedata.category(ch) in ("Cf", "Cc"):
            continue
        chars.append(ch)
    return re.sub(r"\s+", " ", "".join(chars)).strip()


class Seeder:
    def __init__(self, config: dict):
        self.gen = config["generation"]
        self.fields = config["fields"]
        self.names = config["names"]
        self.api = config["api"]
        self.bad_kinds = config["broken_rows"]["kinds"]
        self.base_url = self.api["base_url"].rstrip("/")
        self.token: str | None = None
        self.lock = threading.Lock()
        self.used_names: set[str] = set()
        self.accepted_names: list[str] = []
        self.stats: Counter = Counter()
        self.databases: dict | None = None
        self.started = 0
        self.target = 0
        self.kept_sent = 0
        self.kept_stored = 0
        self.kept_id: int | None = None
        self.progress_every = 2000
        self.next_progress = 2000

    # Row generation

    def unique_name(self) -> str:
        n, max_len = self.names, self.fields["name_max_length"]
        with self.lock:
            while True:
                name = " ".join(p for p in (random.choice(n["prefixes"]), random.choice(n["cores"]),
                                            random.choice(n["suffixes"])) if p)
                if name in self.used_names:
                    name = f"{name} {random.randint(2, 9999)}"
                if name not in self.used_names and len(name) <= max_len:
                    self.used_names.add(name)
                    return name

    def maybe_null(self, value):
        # Each row draws its own rate between the min and max in seeding.toml
        rate = random.uniform(self.gen["null_rate_min"], self.gen["null_rate_max"])
        return None if random.random() < rate else value

    def valid_row(self) -> dict:
        f = self.fields
        start, end = f["release_from"], f["release_to"]
        release = start + timedelta(days=random.randint(0, (end - start).days))
        return {
            "name": self.unique_name(),
            "sector": random.choice(f["sectors"]),
            "price": self.maybe_null(round(random.uniform(f["price_min"], f["price_max"]), f["price_decimals"])),
            "release": self.maybe_null(release.isoformat()),
        }

    def bad_row(self) -> tuple[str, dict]:
        f = self.fields
        row = self.valid_row()
        kinds = list(self.bad_kinds)
        with self.lock:
            if not self.accepted_names and "duplicate_name" in kinds:
                kinds.remove("duplicate_name")
        kind = random.choice(kinds)
        if kind == "name_too_long":
            # Letters only past the limit, so a trailing space cannot trim the name back into range.
            limit = f["name_max_length"]
            target = random.randint(limit + 1, limit + 30)
            base = stored_name(row["name"]) or "Name"
            row["name"] = (base + ("x" * target))[:target]
        elif kind == "empty_name":
            row["name"] = ""
        elif kind == "price_out_of_range":
            spread = max(1.0, f["price_max"] - f["price_min"])
            too_high = random.uniform(f["price_max"] + 0.01, f["price_max"] + spread * 4)
            too_low = random.uniform(f["price_min"] - spread * 2, f["price_min"] - 0.01)
            row["price"] = round(random.choice([too_high, too_low]), f["price_decimals"])
        else:
            with self.lock:
                row["name"] = random.choice(self.accepted_names)
        return kind, row

    # HTTP

    def request(self, method: str, path: str, body: dict | None = None) -> tuple[int, str]:
        data = json.dumps(body).encode() if body is not None else None
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        req = urllib.request.Request(self.base_url + path, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=self.api["request_timeout_seconds"]) as resp:
                return resp.status, resp.read().decode()
        except urllib.error.HTTPError as e:
            if e.code == 401 and not self.token:
                sys.exit(SIGN_IN_MISSING)
            return e.code, e.read().decode()

    def post_with_retry(self, row: dict) -> tuple[int, str]:
        # Retries a dropped connection or a 5xx (including 503 while migrating), never a 4xx
        max_retries = self.api["max_retries"]
        for attempt in range(max_retries + 1):
            try:
                status, body = self.request("POST", "/industries", row)
                if status < 500 or attempt == max_retries:
                    return status, body
            except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
                if attempt == max_retries:
                    return 0, str(e)
            with self.lock:
                self.stats["retries"] += 1
            time.sleep(self.api["retry_delay_seconds"] * 2 ** attempt)
        return 0, "unreachable"

    def wait_until_ready(self) -> None:
        deadline = time.time() + self.api["ready_timeout_seconds"]
        while time.time() < deadline:
            try:
                status, body = self.request("GET", "/health")
                health = json.loads(body)
                if health["state"] == "ready":
                    print("API ready")
                    return
                if health["state"] == "failed":
                    sys.exit(f"API reports a failed database: {health['message']}")
                print(f"Waiting on the database: {health['message']}")
            except (urllib.error.URLError, ConnectionError, TimeoutError):
                print(f"Waiting for the API at {self.base_url}")
            time.sleep(2)
        sys.exit("Gave up waiting for the API to become ready")

    # One row end to end

    def send(self, kind: str, row: dict) -> None:
        status, body = self.post_with_retry(row)
        with self.lock:
            if kind == "valid":
                if status == 201:
                    self.stats["accepted"] += 1
                    self.accepted_names.append(row["name"])
                    if row["price"] is None:
                        self.stats["null_price"] += 1
                    if row["release"] is None:
                        self.stats["null_release"] += 1
                else:
                    self.stats["valid_rejected"] += 1
                    print(f"  valid row rejected ({status}): {row} -> {body[:200]}")
            else:
                if status in (400, 409):
                    self.stats[f"blocked_{kind}"] += 1
                elif status == 201:
                    stored = stored_name(row["name"])
                    limit = self.fields["name_max_length"]
                    # A trimmed name that fits is legal. Anything else that was stored broke a rule.
                    if kind == "trimmed_space" and len(stored) <= limit:
                        self.stats["kept"] += 1
                        self.kept_sent = len(row["name"])
                        self.kept_stored = len(stored)
                        self.kept_id = json.loads(body).get("id")
                    else:
                        self.stats["holes"] += 1
                        print(f"  A stored {kind} broke the rule: {row}")
                else:
                    self.stats["bad_other"] += 1
                    print(f"  broken row got {status} ({kind}): {body[:200]}")
            if kind == "valid" and status == 201:
                self.note_progress()

    def load_rules(self) -> None:
        # The API's rules win over config.toml, so the broken rows stay broken after a rules change
        status, body = self.request("GET", "/schema")
        if status != 200:
            print("Couldn't read /schema, using the limits in config.toml")
            return
        rules = {f["key"]: f for f in json.loads(body)["fields"]}
        f = self.fields
        if rules.get("name", {}).get("maxLength"):
            f["name_max_length"] = rules["name"]["maxLength"]
        price = rules.get("price", {})
        if price.get("min") is not None:
            f["price_min"] = float(price["min"])
        if price.get("max") is not None:
            f["price_max"] = float(price["max"])
        options = [s for s in (rules.get("sector", {}).get("options") or []) if s]
        if options:
            f["sectors"] = options
        print(f"Rules version {json.loads(body)['version']}: name up to {f['name_max_length']}, "
              f"price {f['price_min']:g} to {f['price_max']:g}, sectors {', '.join(f['sectors'])}")

    def load_existing_names(self) -> None:
        # Real rows are off limits for new names, and give the duplicate test something to hit
        status, body = self.request("GET", "/industries")
        if status != 200:
            sys.exit(f"Couldn't read the existing rows ({status})")
        names = [row["name"] for row in json.loads(body)]
        self.used_names.update(names)
        self.accepted_names.extend(names)
        self.started = len(names)
        print(f"Found {len(names)} existing rows")

    def bad_rows_for(self, valid_count: int) -> int:
        if not self.bad_kinds or self.gen["bad_row_rate"] == 0:
            return 0
        return max(1, round(valid_count * self.gen["bad_row_rate"]))

    def sign_in(self) -> None:
        file_user, file_password = load_control_account()
        user, password = resolve_login(
            file_user, file_password, os.environ.get("SEED_USER"), os.environ.get("SEED_PASSWORD")
        )
        if not user or not password:
            sys.exit(SIGN_IN_MISSING)
        status, body = self.request("POST", "/auth/login", {"username": user, "password": password})
        if status != 200:
            sys.exit(f"Couldn't sign in as {user}: {json.loads(body).get('detail', body)}")
        payload = json.loads(body)
        self.token = payload["token"]
        account = payload.get("user") or {}
        if account.get("mustChangePassword"):
            sys.exit(
                f"{user} still has to pick a new password on Your account. "
                "This command will not add rows until then."
            )
        print(f"Signed in as {user}")
        # /health only names the databases to someone signed in
        status, body = self.request("GET", "/health")
        databases = json.loads(body).get("databases") or {}
        live, history = databases.get("live"), databases.get("history")
        if status != 200 or not live or not history:
            sys.exit("The health check does not name the live database and the history database")
        self.databases = databases
        print(
            f"Writing to {live['database']} on {live['host']} port {live['port']}. "
            f"History is {history['database']} on {history['host']} port {history['port']}."
        )

    def place(self) -> str:
        live = self.databases["live"]
        return f"{live['database']} on {live['host']} port {live['port']}"

    def history_place(self) -> str:
        history = self.databases["history"]
        return f"{history['database']} on {history['host']} port {history['port']}"

    def count_line(self) -> str:
        added = self.stats["accepted"]
        kept = self.stats["kept"]
        removed = self.stats["kept_removed"]
        refused = sum(v for k, v in self.stats.items() if k.startswith("blocked_"))
        total = self.started + added + kept - removed
        limit = self.fields["name_max_length"]
        if kept:
            kept_bit = (
                f"Sent {self.kept_sent} characters, stored {self.kept_stored} "
                f"after the space was trimmed, and {limit} is allowed."
            )
            if removed:
                kept_bit = f"Trim check passed and its row was deleted. {kept_bit}"
            else:
                kept_bit = f"Kept {kept}, the trim check row couldn't be deleted. {kept_bit}"
        else:
            kept_bit = "Kept 0."
        return (
            f"Started at {self.started} in {self.place()}. Added {added}. {kept_bit} "
            f"Refused {refused}. The table now has {total}."
        )

    def note_progress(self) -> None:
        # The lock is already held. The finishing line is printed once, from report.
        added = self.stats["accepted"]
        while added >= self.next_progress:
            milestone = self.next_progress
            self.next_progress += self.progress_every
            if self.target and milestone >= self.target:
                return
            print(self.count_line(), flush=True)

    def send_known(self) -> None:
        # One name the API trims back to the limit, and one the limit still refuses.
        limit = self.fields["name_max_length"]
        stamp = str(time.time_ns())
        stored = ("Trim" + stamp)[:limit].ljust(limit, "x")
        space_name = stored + " "
        letter = (("Long" + stamp) + ("y" * (limit + 1)))[: limit + 1]
        if not letter[-1].isalpha():
            letter = letter[:-1] + "y"
        sector = self.fields["sectors"][0]
        self.used_names.add(stored)
        self.send("trimmed_space", {"name": space_name, "sector": sector, "price": 1, "release": None})
        if self.stats["kept"] < 1 or self.stats["holes"]:
            sys.exit(
                f"The trailing-space name was not kept as a legal {limit}-character name "
                f"(sent {len(space_name)} characters)"
            )
        # The API taking it is the whole check, so the row goes again and the total matches the batch
        status, body = self.request("DELETE", f"/industries/{self.kept_id}") if self.kept_id else (0, "no id")
        if status == 200:
            self.stats["kept_removed"] += 1
        else:
            print(f"  Couldn't delete the trim check row {stored} ({status}): {body[:200]}")
        self.send("name_too_long", {"name": letter, "sector": sector, "price": 1, "release": None})
        if self.stats["holes"]:
            sys.exit("The letter-ending name was stored, and it is over the limit")

    def run(self, count: int) -> int:
        self.target = count
        self.next_progress = self.progress_every
        self.wait_until_ready()
        self.sign_in()
        self.load_rules()
        self.load_existing_names()
        self.send_known()
        started = time.time()
        with ThreadPoolExecutor(max_workers=self.api["workers"]) as pool:
            # Send in rounds until enough valid rows got in, a rejected valid row gets replaced next round
            while self.stats["accepted"] < count:
                remaining = count - self.stats["accepted"]
                jobs = [("valid", self.valid_row()) for _ in range(remaining)]
                jobs += [self.bad_row() for _ in range(self.bad_rows_for(remaining))]
                random.shuffle(jobs)
                list(pool.map(lambda job: self.send(*job), jobs))
                if self.stats["valid_rejected"] > count:
                    print("Too many valid rows rejected, check that config.toml [fields] matches the API rules")
                    break
        self.report(time.time() - started)
        return 1 if self.stats["holes"] or self.stats["valid_rejected"] else 0

    def report(self, seconds: float) -> None:
        s = self.stats
        blocked = {k.removeprefix("blocked_"): v for k, v in s.items() if k.startswith("blocked_")}
        added = s["accepted"]
        print()
        print(f"Done in {seconds:.1f}s")
        print(f"{self.count_line()} History is {self.history_place()}.")
        if blocked:
            print(f"Refused by kind: {dict(sorted(blocked.items()))}")
        print(f"Of the added rows, {s['null_price']} have no price ({s['null_price'] / max(1, added):.1%}).")
        print(f"Of the added rows, {s['null_release']} have no release ({s['null_release'] / max(1, added):.1%}).")
        if s["valid_rejected"]:
            print(f"Intended rows rejected: {s['valid_rejected']}")
        if s["holes"]:
            print(f"Stored values that broke a rule: {s['holes']}")
        if s["retries"]:
            print(f"Retries: {s['retries']}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed synthetic industries through the API")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG, help="main config with [fields] (default scripts/config.toml)")
    parser.add_argument("--seeding", type=Path, default=DEFAULT_SEEDING, help="seed settings (default scripts/seeding.toml)")
    parser.add_argument("--count", type=int, help="override generation.count")
    parser.add_argument("--seed", type=int, help="override generation.seed")
    parser.add_argument("--dry-run", action="store_true", help="print sample rows, send nothing")
    args = parser.parse_args()

    config = load_config(args.config, args.seeding)
    count = args.count if args.count is not None else config["generation"]["count"]
    seed = args.seed if args.seed is not None else config["generation"]["seed"]
    if seed:
        random.seed(seed)

    seeder = Seeder(config)
    print(f"Config: {args.config.name} and {args.seeding.name}, {count} rows, {config['generation']['bad_row_rate']:.0%} broken, "
          f"empty rate {config['generation']['null_rate_min']:.0%} to {config['generation']['null_rate_max']:.0%}")

    if args.dry_run:
        for _ in range(8):
            print("valid ", seeder.valid_row())
        seeder.accepted_names.append("Atlas Steel Group")
        if seeder.bad_kinds:
            for _ in range(4):
                print("broken", seeder.bad_row())
        return 0

    return seeder.run(count)


if __name__ == "__main__":
    sys.exit(main())
