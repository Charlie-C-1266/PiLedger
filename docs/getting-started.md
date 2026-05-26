# Getting Started

Pick the path that fits how you want to run PiLedger. Docker Compose is the lowest-friction option for trying it out; the local Python flows are better if you want to hack on the code.

| Path | Best for | Prereqs |
|---|---|---|
| [Docker Compose](#run-with-docker-compose) | Just trying it / self-hosting on a server you already use Docker on | Docker Engine + Compose v2 (`docker compose ...`) |
| [Local — `uv`](#local-setup-with-uv-fast) | Developers who want the fastest possible install | Python 3.12, [uv](https://docs.astral.sh/uv/) |
| [Local — `pip` + `venv`](#local-setup-with-pip--venv) | Developers without `uv`, or anyone who prefers the standard toolchain | Python 3.12 |

Whichever path you pick, the dashboard ends up on **http://localhost:8080**. The first visit redirects to `/login`; click **Register** to create your first account.

## Run with Docker Compose

The repository ships a `Dockerfile` and `docker-compose.yml` that build a Python 3.12 image, run the app as a non-root user, and persist your SQLite database in a named volume so it survives rebuilds.

```bash
# From the project root
docker compose up -d                # build the image and start the service in the background
docker compose logs -f piledger      # follow the application logs (Ctrl+C to detach)
```

Then open **http://localhost:8080**.

To stop the container without losing data:

```bash
docker compose down                 # keeps the piledger-data volume → your accounts persist
```

To wipe the database and start fresh:

```bash
docker compose down -v              # also drops the piledger-data volume
```

### Configuration

Override defaults via environment variables on the host before running `docker compose up`. The most useful are:

| Variable | Default | Purpose |
|---|---|---|
| `COOKIE_SECURE` | unset | Set to `true` when fronting the container with an HTTPS-terminating proxy so session cookies only travel over TLS. |

The host port (`8080`) is set in `docker-compose.yml`; change the left half of `"8080:8080"` if 8080 is already in use on your host. The container always serves on 8080 internally.

## Local setup with `uv` (fast)

[`uv`](https://docs.astral.sh/uv/) is a Rust-based Python package manager — typically 10-100x faster than `pip` for cold installs. The commands below assume `uv` is already on your `PATH` (install with `curl -LsSf https://astral.sh/uv/install.sh | sh` if not).

```bash
# From the project root
uv sync                                      # install all deps (runtime + dev) from uv.lock

./start.sh                                   # serves on 0.0.0.0:8080
```

`uv sync` creates a `.venv/` directory by default. If you prefer the `venv/` layout that `start.sh` and the systemd snippet in [Deployment](deployment.md) expect, use `uv venv venv && uv pip install -r requirements.txt` instead.

## Local setup with `pip` + `venv`

The standard-library flow — no extra tooling required beyond Python 3.12 itself.

```bash
# From the project root
python3 -m venv venv                                 # create the virtual environment
./venv/bin/pip install -r requirements.txt           # install runtime dependencies

./start.sh                                           # serves on 0.0.0.0:8080
```

To install dev dependencies (pytest, ruff, mypy, etc.) with pip, run: `./venv/bin/pip install pytest httpx pytest-playwright ruff mypy pytest-cov pip-audit`.

The full operational reference — environment variables, running headless, the systemd service unit, firewall notes — lives in [Deployment](deployment.md).
