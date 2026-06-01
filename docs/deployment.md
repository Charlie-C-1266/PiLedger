# Deployment

This is the deeper reference for running PiLedger in production-like environments. For the quickest path to a running instance, see [Getting Started](getting-started.md).

## Prerequisites

- Python 3.12
- Node 20+ — to build the React frontend from source (see below). Not needed at runtime, only at build time; the Docker image builds it in a separate stage so a containerised deploy needs neither Node nor Python on the host.

## First-time setup

Two equivalent recipes — pick whichever package manager you prefer.

**With [`uv`](https://docs.astral.sh/uv/) (recommended):**

```bash
cd /path/to/piledger

uv sync             # installs runtime + dev deps from the lockfile into .venv/
```

**With `pip` + `venv` (standard library only):**

```bash
cd /path/to/piledger

python3 -m venv venv
./venv/bin/pip install -r requirements.txt   # runtime deps only (pinned from uv.lock)
```

The `uv` flow creates `.venv/` by default; the `pip` flow creates `venv/`. Both work with `./start.sh` and the systemd snippet below. For dev tools (pytest, ruff, mypy, etc.) in the pip flow, install them manually or use `uv sync` instead.

**Then build the frontend** (either recipe). The compiled SPA bundle (`src/static/dist/`) is gitignored, so a from-source deploy must build it once before the dashboard will serve; rebuild it whenever the frontend changes:

```bash
cd /path/to/piledger/frontend
npm ci
npm run build      # outputs to ../src/static/dist/
```

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PILEDGER_DB` | `piledger.db` at the project root | Absolute or relative path to the SQLite database file. Useful for pointing different environments (dev / staging / prod) at different databases without editing source. |
| `COOKIE_SECURE` | `false` | When set to `true` / `1` / `yes`, the session cookie is issued with the `Secure` flag so it is only transmitted over HTTPS. Enable this whenever you front the app with a TLS-terminating proxy. |
| `PILEDGER_LOGIN_RATE_LIMIT` | `5/minute` | SlowAPI rate-limit string for `POST /api/auth/login`. Accepts slowapi syntax like `10/minute`, `100/hour`. |

## Running the server

```bash
./start.sh
```

This is equivalent to:

```bash
./venv/bin/uvicorn --app-dir src app:app --host 0.0.0.0 --port 8080
```

The server starts, creates `piledger.db` on first run, and begins serving on port 8080.

### Changing the port

Edit `start.sh` and replace `--port 8080` with any available port. If the port is below 1024 the process will need to run as root (not recommended) or you can use a port above 1024 and front it with a reverse proxy.

## Running in the background

### nohup

```bash
nohup ./start.sh > piledger.log 2>&1 &
echo $! > piledger.pid   # save the PID to stop it later
```

To stop it:

```bash
kill $(cat piledger.pid)
```

### systemd

For a more robust setup, create a systemd service:

```ini
# /etc/systemd/system/piledger.service
[Unit]
Description=PiLedger Finance Dashboard
After=network.target

[Service]
User=piledger
WorkingDirectory=/path/to/piledger
ExecStart=/path/to/piledger/venv/bin/uvicorn --app-dir /path/to/piledger/src app:app --host 0.0.0.0 --port 8080
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now piledger
```

## Network access

The server binds to `0.0.0.0`, which means it listens on all network interfaces. Any device on the same network as the VM can reach the dashboard at:

```
http://<VM-IP-address>:8080
```

To find the VM's IP address:

```bash
ip addr show | grep 'inet ' | grep -v 127.0.0.1
```

### Firewall

If the VM runs a firewall (e.g. `ufw`), the port must be opened:

```bash
sudo ufw allow 8080/tcp
```

## HTTPS

The server itself runs over plain HTTP, which is acceptable on a trusted LAN but exposes session cookies and financial data in transit on anything internet-facing. Front Uvicorn with a TLS-terminating reverse proxy — Caddy and nginx are the two configurations in widest self-hosted use.

**Before exposing the app behind a proxy:**

1. **Bind Uvicorn to `127.0.0.1`, not `0.0.0.0`.** Edit `start.sh` (or the `command:` line in `docker-compose.yml`) to use `--host 127.0.0.1` so the only path in is via the proxy. Otherwise port 8080 stays reachable from the LAN and the TLS gate can be bypassed.
2. **Set `COOKIE_SECURE=true`.** This adds the `Secure` flag to the session cookie so browsers refuse to send it over plain HTTP. In Docker Compose set the env var in your `.env` file; for bare-metal `start.sh` add `export COOKIE_SECURE=true`.
3. **Decide where rate limiting lives.** The app-layer login rate limit keys on the socket peer IP, which behind a proxy means every client shares one bucket (see [Security](security.md)). Add per-client limiting at the proxy layer too — both snippets below include a real-IP-aware rate limit on the login endpoint.

### Caddy

Caddy auto-provisions and renews a Let's Encrypt certificate if the host has a public DNS name. Drop this into `/etc/caddy/Caddyfile`:

```caddy
piledger.example.com {
    # Belt-and-braces login rate limit; the app-layer limit cannot
    # distinguish clients once they share a proxy.
    @login path /api/auth/login
    rate_limit @login 5r/m

    reverse_proxy 127.0.0.1:8080 {
        header_up X-Forwarded-Proto {scheme}
        header_up X-Real-IP {remote_host}
    }
}
```

Reload with `caddy reload --config /etc/caddy/Caddyfile`.

### nginx

The `proxy_http_version 1.1` and empty-`Connection` header lines are mandatory — without them, nginx defaults to HTTP/1.0 upstream and drops keep-alive, which manifests as slow page loads and broken WebSocket-style requests. Drop this into `/etc/nginx/sites-available/piledger`:

```nginx
limit_req_zone $binary_remote_addr zone=piledger_login:10m rate=5r/m;

server {
    listen 443 ssl http2;
    server_name piledger.example.com;

    # Provide your own cert paths here; certbot --nginx is the common path.
    ssl_certificate     /etc/letsencrypt/live/piledger.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/piledger.example.com/privkey.pem;

    location /api/auth/login {
        limit_req zone=piledger_login burst=2 nodelay;
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection        "";
    }

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection        "";
    }
}
```

Symlink into `sites-enabled` and reload: `sudo ln -s /etc/nginx/sites-available/piledger /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx`.

### Verifying the proxy is up

```bash
# From any host on the network — should return 200 and a small JSON body.
curl https://piledger.example.com/healthz
# Expected: {"ok":true,"version":"...","uptime_s":<int>}
```

A `/healthz` probe is the cleanest check because it returns 200 even before login is configured, so it isolates "proxy + TLS + app" from "credentials work".
