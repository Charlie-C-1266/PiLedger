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
