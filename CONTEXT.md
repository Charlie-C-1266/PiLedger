# PiLedger

Self-hosted, single-tenant-per-deployment personal finance app. The domain is one person's (or a household's) accounts, balances, transactions, budgets, and savings goals, all isolated per user.

## Language

### Identity & access

**User**:
An authenticated principal with a `username` and `password_hash`. The unit of data isolation — every domain row carries a `user_id` and no user can read or write another user's rows. Registration is open and the model is flat: there is no admin and no role hierarchy.
_Avoid_: Account (means something else here — see below), Customer, Client.

**Account**:
A financial account belonging to a User — a current/savings/loan/credit/investment holding with a balance and currency. **Never** use "account" to mean the User/login.
_Avoid_: using "account" for the login principal.

**Session**:
A 30-day server-side login, keyed by an `HttpOnly` cookie, created at password (or future OIDC) login. The only credential allowed on the **security-plane**.

**Personal Access Token (PAT)**:
A per-user bearer credential for headless clients (CLI, Shortcuts). Authenticates the **data-plane only** — it is refused on the security-plane. Stored hashed; shown in plaintext exactly once at creation.
_Avoid_: API key, token (unqualified).

**OIDC link**:
The binding of an external SSO identity (`oidc_sub` claim) to a PiLedger User. A logged-in User connects SSO from settings (a **security-plane** action that writes `oidc_sub` on their own row); a never-before-seen `sub` auto-provisions a fresh User. There is no email-matching and no cross-user merge.
_Avoid_: SSO account, federated account.

**Data-plane**:
The set of routes a PAT *or* a Session may call — accounts, transactions, dashboard, budget, goals, rates, import. Guarded by `require_auth`.

**Security-plane**:
The set of routes only a Session may call — password change, 2FA enrolment, OIDC linking, PAT issue/revoke, account deletion. Guarded by `require_session`. The explicit route list *is* the security boundary.

### Money movement

**Transaction**:
A signed money movement on one Account: `amount_cents` (positive inflow / negative outflow), `occurred_at`, `merchant`, free-text `category`, optional `note`. Two transactions with identical fields are **legitimate** (two identical coffees) — duplicates are never forbidden at the database level; CSV import dedups softly at import time only.
_Avoid_: entry, posting, line item.

**Transfer**:
A pair of opposing Transactions across two Accounts, linked by a shared `transfer_id`. Not double-entry bookkeeping — just the two rows tied together.
_Avoid_: payment, movement (unqualified).

**Category**:
A free-text label on a Transaction (`transactions.category`, a string). `user_categories` is a separate flat per-user list of names used for autocomplete/validation — there is **no** foreign key binding the two, and no category hierarchy (no parent/child).
_Avoid_: tag, label (when you mean the formal Category), implying an FK or sub-categories exist.

**Holding**:
A position within an investment-type Account: `(ticker, units, last_price_cents, last_price_at)`. The Account's balance is *derived* — a price or units change recomputes `sum(units × last_price_cents)` and writes a `balance_history` snapshot, so invest Accounts flow through the same balance/net-worth/FX pipe as every other Account. `last_price_cents` is denominated in the Account's own currency (no per-ticker source currency).
_Avoid_: position, lot, security.

### Auditing

**Audit log**:
A system-wide security log of authentication-relevant events (`login_success`, `login_failure`, `logout`, `password_change`, `account_delete`, `oidc_link`, `totp_enable`/`disable`, `pat_issue`/`revoke`). Deliberately **not** a per-user resource: it is excluded from `USER_SCOPED_TABLES`, so it is not in a User's export and is not cascade-deleted with the User. `user_id` is nullable — a `login_failure` against an unknown username has no User.
_Avoid_: activity feed, history (those are user-facing data-plane concepts).

**Anonymise-on-delete**:
The reconciliation between the retained Audit log and a User's right to delete their data. Account deletion does not erase the User's audit rows (that would let an attacker self-erase) — it nulls `user_id` and scrubs `ip`/`user_agent`, keeping the de-identified security skeleton (`event` + timestamp).

## Example dialogue

> **Dev:** "Should the CLI be able to rotate the password with its token?"
> **Domain:** "No — the password lives on the security-plane. A PAT is data-plane only, so the CLI gets a 403 there and has to fall back to a real Session."
> **Dev:** "And if someone steals a PAT?"
> **Domain:** "They can read and edit that User's money data, but they can't change the password, disable 2FA, or mint more PATs — those need a Session. So we can still revoke them."
