# Audit log is a system security record, outside USER_SCOPED_TABLES, anonymised on delete

The audit log (P2-8) records authentication-relevant events: `login_success/failure`, `logout`, `password_change`, `account_delete`, `oidc_link`, `totp_enable/disable`, `pat_issue/revoke`. The plan originally specified adding `audit_log` to `USER_SCOPED_TABLES` — the constant that makes a table part of the per-user export (`GET /api/export`) and the per-user cascade delete (`DELETE /api/auth/me`).

We are **not** treating it as a per-user resource. The audit log is a system security record:

- It is **excluded from `USER_SCOPED_TABLES`** — not in a user's export, not cascade-deleted with the user. (This is a deliberate exception; the `tests/test_export.py` guard test enforces that constant's completeness, so the exception must be coded and asserted explicitly.)
- `user_id` is **nullable** — a `login_failure` against an unknown username has no user to attach.
- Account deletion **anonymises rather than deletes**: `DELETE /api/auth/me` nulls `user_id` and scrubs `ip`/`user_agent` on the user's audit rows, keeping the de-identified security skeleton (`event` + timestamp).

## Why

- A security log the audited party can delete is not a security log: if `account_delete` cascade-wiped the audit rows, an attacker with a session could delete the account to erase their own trail, and the deletion event itself would vanish with the thing it records.
- A `login_failure` for an unknown username has no home in a strictly user-scoped table.
- Anonymise-on-delete reconciles retention with the user's right to erasure without inventing an admin/approval flow — PiLedger has no admin role and registration is flat, so deletion must stay self-service. Identifying fields (`user_id`, `ip`, `user_agent`) are personal data and are removed; the non-identifying skeleton (`event`, `at`) is retained for forensic value.

## Consequences

- The per-user "export everything / delete everything about me" story gains one carve-out: de-identified security events persist. For IP/user-agent rows tied to authentication, this retention is the defensible posture.
- Full IPs are stored while an account is live (privacy-by-design IP truncation/hashing was considered and deferred for forensic precision in a homelab context); they are scrubbed on deletion.
