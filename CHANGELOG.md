# Changelog

All notable changes to PiLedger are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Entries are concise and user-facing; commit history and the originating PR hold the file-level detail.
Releases before the current cycle live in [CHANGELOG-ARCHIVE.md](CHANGELOG-ARCHIVE.md).

---

## [Unreleased]

### Added

- Documentation link in Settings — signed-in users can reopen the built docs (`/guide`) without logging out.
- Multi-currency end to end: account currency picker, manual FX-rate editor, and a missing-rate warning on Overview. Wires up the previously orphaned `/api/rates` endpoints so net worth no longer treats unconvertible foreign balances as 1:1.

### Changed

- Changelog handling slimmed down: entries are now concise one-liners (no affected-file lists or root-cause essays), released history moved to `CHANGELOG-ARCHIVE.md`, and the `CLAUDE.md` guidance updated to match so the bulky history is no longer loaded into context on every change.
- Split the 453-line `Settings` screen into per-section card components under `components/settings/` (Appearance, Categories, Exchange rates, Change password, Help, Session, Danger zone) behind a shared `SettingsCard` wrapper. No behaviour change; the screen is now a ~20-line shell.
- Documented every Python function in `src/` (docstring coverage 36% → 100%), explaining intent and edge cases in the existing prose style, and added a ruff rule (D102/D103, tests exempt) so new public functions and methods must carry a docstring.

### Fixed

- Mobile no longer zooms in when opening the add/edit transaction, goal, account, and transfer modals. The form fields render below iOS Safari's 16px focus-zoom threshold, and the existing guard couldn't override their CSS-module class size; it now forces 16px on touch widths.
- Removed two phantom chart rows (savings projection, account balance) from the frontend docs — neither chart exists in the React frontend.
- Switching your base currency to one you have no rate for is now rejected with a clear message instead of silently wiping your whole exchange-rate table.
- Amounts ending in a half-cent (e.g. 2.675) no longer lose a penny on save — money is now rounded on the value entered rather than its binary-float approximation.
- Concurrent requests no longer fail with "database is locked": connections now wait on a lock (5s busy timeout) and use WAL journaling so reads stay responsive during a write.

## [3.0.0] — 2026-06-01

### Added

- Zero-based envelope **Budget** screen: income lines, envelope groups with live sliders, a "left to budget" hero, a safe-to-spend rail, an allocation donut, and a budget-vs-actual trend chart — backed by a new `GET /api/budget` plus income/group/envelope CRUD (schema v7).
- Functional header search across accounts, goals, and transactions (command-palette overlay, with a mobile search button).
- Goals can be edited, deleted, and linked to an account for automatic balance tracking.

### Changed

- Accounts page shows a single filterable list (All / Assets / Debts) instead of three overlapping sections.
- Split the 1,656-line `src/app.py` into per-resource routers + shared services (8-stage refactor, no behaviour change).
- Removed hardcoded `/home/charlie/` paths from the deployment and backup docs.

### Fixed

- Refreshed the docs to match the React/Vite stack and retire the old "Budget Planner".
- Budget envelope sliders no longer run away into the billions when dragged — the slider ceiling is now stable and independent of the dragged value.

### Removed

- Retired the orphaned `budget_items` model and its `/api/budget*` endpoints, freeing the namespace for the envelope Budget screen (schema v6 drops the table).
