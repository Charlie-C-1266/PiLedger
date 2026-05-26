# Security Notes

## What is protected

- Passwords are hashed with PBKDF2-SHA256 at 260 000 iterations; the salt is unique per user.
- Session tokens have 256 bits of entropy and are stored `HttpOnly` so they are not accessible to JavaScript.
- All database queries use parameterised statements; SQL injection is not possible.
- Account ownership is enforced at the database query level (`WHERE user_id = ?`) on every read and write operation, not just at the route level.
- HTML output in the dashboard is escaped via a custom `esc()` function before being inserted into the DOM, preventing stored XSS from account names or notes.
- `POST /api/auth/login` is rate-limited via [SlowAPI](https://slowapi.readthedocs.io/) at a default of **5 attempts per minute** per source IP. The cap is configurable with `PILEDGER_LOGIN_RATE_LIMIT` (slowapi string syntax, e.g. `10/minute`, `100/hour`). The limiter is keyed by the socket peer IP — so behind a reverse proxy every client shares one bucket, and the proxy must still do real per-client rate limiting (see [Deployment — HTTPS](deployment.md#https)). On the bare-metal LAN deployment this is a real defence-in-depth backstop against online brute-force.
- HTTP responses carry a strict defensive header set on every reply: HSTS (one year, `includeSubDomains`), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, a `Permissions-Policy` disabling geolocation/microphone/camera/payment, and a Content-Security-Policy locked to `'self'` for scripts/connect/font with no `'unsafe-inline'` on `script-src`. See `src/security.py`.
- Dependencies are pinned via `uv.lock` for reproducible builds, and `pip-audit` runs in CI on every PR to catch known CVEs in the dependency tree.

## What is not protected

- There is no built-in HTTPS. On a trusted LAN this is generally acceptable, but the session cookie and all data are transmitted in plaintext. Front the app with a TLS-terminating reverse proxy (nginx, Caddy) for any internet-facing deployment, and set `COOKIE_SECURE=true` so the session cookie is only sent over HTTPS. See [Deployment — HTTPS](deployment.md#https).
- The app-layer login rate limit (above) keys on the socket peer IP. Behind a reverse proxy that means **every client shares one bucket** — the limiter still caps the *aggregate* login rate but cannot distinguish between distinct upstream IPs. Add proxy-layer rate limiting (e.g. nginx `limit_req`, Caddy `rate_limit`) before exposing the service to the public internet, since only the proxy can see real client IPs.
- There is no account lockout or two-factor authentication.
- Expired session rows are opportunistically purged inside `make_session()` (every successful login deletes any session whose `expires_at` is in the past), so the `sessions` table self-trims as long as users keep logging in. There is no scheduled cleanup for the case where no one logs in for a long time.
