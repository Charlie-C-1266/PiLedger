# Authentication System

## Password storage

Passwords are never stored in plaintext. On registration:

1. A 16-byte (32-hex-character) random salt is generated with `secrets.token_hex(16)`.
2. The password is hashed using `hashlib.pbkdf2_hmac('sha256', password, salt, 260_000)` — 260 000 PBKDF2-SHA256 iterations, which is above the OWASP minimum recommendation.
3. The stored value is `"<salt_hex>:<key_hex>"`.

On login, the salt is extracted from the stored value, the candidate password is hashed with the same parameters, and the result is compared using `secrets.compare_digest` to prevent timing attacks.

No third-party password library is required — only Python's standard-library `hashlib` and `secrets` modules.

## Sessions

After a successful login the server:

1. Generates a 64-character hex token (`secrets.token_hex(32)`) — 256 bits of entropy.
2. Purges any session rows whose `expires_at` is in the past (cheap housekeeping on every login).
3. Writes `(token, user_id, expires_at)` to the `sessions` table. Expiry is 30 days from now.
4. Sets an `HttpOnly; SameSite=Lax` cookie named `piledger_session` with `Max-Age=2592000`. The `Secure` flag is also set when the `COOKIE_SECURE` environment variable is `true` / `1` / `yes` — turn this on whenever the app is served over HTTPS.

`HttpOnly` means JavaScript cannot read the cookie, which prevents token theft via XSS. `SameSite=Lax` provides CSRF protection for state-changing requests.

On every protected request FastAPI's `require_auth` dependency (defined in `auth.py`) reads the cookie, queries the `sessions` table for a non-expired matching row, and either injects the `user_id` into the route handler or raises `HTTP 401`.

On logout the session row is deleted from the database and the cookie is cleared. The token is immediately invalid even if the browser retains it.

## Login timing-attack mitigation

`auth.py:dummy_hash()` keeps a single PBKDF2-hashed constant in memory. If a login request arrives with a username that does not exist, the server still runs `verify_password` against this dummy hash before returning `401`. This keeps the time-to-respond statistically indistinguishable between "unknown user" and "wrong password," so an attacker cannot enumerate valid usernames by measuring response latency.

## Personal access tokens (API tokens)

The session cookie works for the browser SPA but is a poor fit for a headless client (a CLI, a scheduled script, an MCP server) — it can't do the login form dance and has no way to survive a 30-day cookie expiry unattended. Personal access tokens (PATs) are the long-lived, revocable alternative for exactly that use case.

### Minting a token

`POST /api/tokens` (session-cookie only — see below) creates a token for the authenticated user:

1. A random value is generated: `"pil_" + secrets.token_urlsafe(32)`.
2. Only its SHA-256 hash is stored, in the `api_tokens` table, alongside a `name` and `created_at`.
3. The raw `pil_...` value is returned in that one response and never again — losing it means minting a new token.

`GET /api/tokens` lists a user's tokens (`id`, `name`, `created_at`, `last_used_at` — never the raw value or its hash). `DELETE /api/tokens/{id}` revokes one immediately.

### Using a token

Send it as a bearer credential on any `/api/*` route:

```
Authorization: Bearer pil_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

`require_auth` (the dependency every protected route already uses) tries the `Authorization` header first — hashing the presented value and looking it up in `api_tokens` — and falls back to the `piledger_session` cookie if the header is absent or doesn't resolve. Existing session-cookie behaviour is unchanged; a token is simply a second way in. A hit opportunistically bumps `last_used_at` (throttled to once per 60 seconds, so token auth doesn't cost an extra write on every request).

A token grants the same access as the account it belongs to — treat it like a password. Revocation (`DELETE /api/tokens/{id}`) is immediate: the row is gone, so the hash lookup on the next request simply misses.

### The token-management routes are session-only

`POST /api/tokens`, `GET /api/tokens`, and `DELETE /api/tokens/{id}` are gated by `require_session_auth` — the cookie-only dependency — rather than `require_auth`. This is deliberate: it means a leaked bearer token can authenticate ordinary API calls but can never mint itself a replacement, enumerate other tokens on the account, or revoke a token out from under the real owner. Minting and managing tokens always requires being logged into the browser session.

### What's excluded from export and account deletion

`api_tokens` carries `user_id`, so it's swept by the `DELETE /api/auth/me` cascade like every other user-scoped table. It is deliberately **excluded** from `GET /api/export`, though (see `constants.EXPORT_EXCLUDED_TABLES`): a token's hash and name are credentials, not portable user data, and would be useless (and a needless secret to handle) in a re-importable export file.
