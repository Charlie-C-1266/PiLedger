# PATs authenticate the data-plane only; the security-plane stays session-only

We are adding Personal Access Tokens (P2-11) so headless clients can authenticate without the login-form + session-cookie dance. The obvious implementation — a single `require_auth_session_or_pat` dependency swapped in everywhere `require_auth` is used — would let a PAT do everything a session can, including changing the password, disabling 2FA, minting more PATs, and deleting the account. A leaked PAT would then be an unrecoverable, self-perpetuating account takeover.

We instead split the auth surface in two:

- **`require_auth`** — accepts a session cookie *or* a `Bearer` PAT. Guards the **data-plane**: accounts, transactions, dashboard, budget, goals, rates, CSV import.
- **`require_session`** — accepts a session cookie *only*. Guards the **security-plane**: password change, TOTP enrol/disable, OIDC link, PAT issue/revoke, account deletion.

## Consequences

- A leaked PAT can read and write the user's money data but cannot entrench itself or lock the owner out — the owner always retains a faster revocation path via their interactive session.
- It is **not** "zero per-route changes": the security-plane routes must be consciously tagged with `require_session`. That explicit list *is* the security boundary, and a test asserts a PAT receives 403 on each of those routes.
- Security-plane audit events (`pat_issue`, `password_change`, `totp_enable`) are guaranteed to be backed by a real interactive session.
- Per-token scopes (read-only/read-write/admin) were considered and rejected as more schema/UI/enforcement surface than the v1.x track warrants; the binary plane split covers the realistic threat.
