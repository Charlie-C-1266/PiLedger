# Changelog

All notable changes to PiLedger are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Entries are concise and user-facing; commit history and the originating PR hold the file-level detail.
Releases before the current cycle live in [CHANGELOG-ARCHIVE.md](CHANGELOG-ARCHIVE.md).

---

## [Unreleased]

## [3.3.0] — 2026-08-24

### Added

- Accounts can now record which institution they're held with, chosen from a list of common UK banks, building societies, card issuers and investment providers (or named yourself). The Accounts list gains a "By institution" view that groups everything you hold with one provider under a single heading with its combined total, and each account card is now branded with its provider — the plain decorative circles are replaced by the institution's name and its brand-coloured mark.
- A Subscriptions page tracks recurring payments and standing orders, showing upcoming renewal dates as a time-ordered list and an interactive, scrollable month calendar; each subscription can be colour-coded and optionally linked to an account.
- Transactions can now be bulk-imported from a bank/card CSV export: pick the target account, confirm which column is which (with a suggested mapping pre-filled), and import — re-uploading an overlapping export skips rows already imported instead of duplicating them.
- Every response now carries an `X-Request-Id` header, and server logs are structured JSON by default (`PILEDGER_LOG_LEVEL` / `PILEDGER_LOG_FORMAT` env vars), making it possible to correlate a log line back to the request that produced it.
- Accounts can now be marked closed: they're kept for balance/transaction history and shown with a "Closed" badge, but no longer accept new transactions, transfers, or CSV imports.
- Personal access tokens for headless clients like scripts or the companion MCP server: create, view, and revoke long-lived `Authorization: Bearer` tokens (sent instead of your password or a browser session cookie) from a new card in Settings, or via the `/api/tokens` API.
- The base currency can now be changed from Settings → Exchange rates; stored exchange rates are re-scaled to the new base, and the switch is refused with the rate to add first when they can't be.
- A privacy toggle in the header (and in Settings → Appearance) masks every amount on screen as `£****` for when someone can see your screen; the choice is remembered per browser.
- Saving a transaction now shows a brief confirmation toast in the corner ("Transaction recorded!"), and a red toast surfaces the failure if a save, edit, or delete doesn't go through.

### Changed

- The Docker runtime image now applies Debian's outstanding OS security updates at build time, so a shipped image isn't left waiting on the upstream `python:3.12-slim` tag to be rebuilt.
- The in-app guide gains a Subscriptions page, and the README now lists Subscriptions and the hide-amounts toggle among the features — both shipped without documentation.
- CI now builds the Docker runtime image and scans it with Trivy, failing the build on fixable HIGH/CRITICAL OS or dependency vulnerabilities.
- CI now runs an OWASP ZAP baseline scan against the running app on every build, uploading a passive-security report as a build artifact (report-only, non-blocking).
- Page transitions now slide each top-level card in from the right in sequence, replacing the fade-and-rise cascade.
- Add/edit dialogs now appear with a centred fade-and-scale and fade back out on close, replacing the instant desktop pop-in and the mobile bottom sheet; the entrance collapses to a plain fade under `prefers-reduced-motion`, and every dialog now closes on Escape.

### Fixed

- React Router updated to 7.18.2, clearing a set of security advisories against the version PiLedger shipped — including an open redirect via backslashes in `<Link>`/`useNavigate`.
- The mobile bottom navigation no longer overflows the screen now that it holds seven destinations: the tab bar scrolls horizontally when the tabs don't all fit and keeps the active tab in view.
- Views now refresh straight after the change that affects them: adding a transaction updates the net-worth trend, editing an exchange rate updates budget spending, and recording a balance updates the account-history chart and savings projections — previously some of these stayed stale until a reload or navigation.
