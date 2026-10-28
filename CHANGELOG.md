# Changelog

All notable changes to PiLedger are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Entries are concise and user-facing; commit history and the originating PR hold the file-level detail.
Releases before the current cycle live in [CHANGELOG-ARCHIVE.md](CHANGELOG-ARCHIVE.md).

---

## [Unreleased]

## [3.4.0] — 2026-10-28

### Fixed

- CSV import no longer drops genuinely repeated same-day transactions (e.g. two identical fares) as duplicates; re-importing an export still skips rows already imported.
- Updated `anyio`, `certifi` and `urllib3` to clear newly-disclosed security advisories flagged by the dependency and image scans.
- Updated `filelock` (used only by the development dependency audit) to clear newly-disclosed security advisories.
- Updated `msgpack` (also used only by the development dependency audit) to clear a newly-disclosed security advisory.
- Each screen now loads once when you navigate to it; previously it loaded twice, and a dialog opened in its first moment (such as an Upcoming item's actions) could close by itself.
- On touch screens, the selected option in a switch (such as List / Calendar) no longer turns hard to read after you tap it.

### Added

- The Subscriptions screen is now called Scheduled and can track regular income and transfers between accounts, not just payments.
- Each account has its own page with its balance, details and recent transactions.
- Per-account balance projection from scheduled transactions and interest (API).
- Scheduled payments, income and transfers can post themselves on their due date, keeping account balances up to date.
- Scheduled items can be set to post automatically, with an Auto badge and a repeat icon on the transactions they create.
- Account pages show projected balances over 1, 3, 6 and 12 months and the scheduled transactions coming up, with Post now, Skip and Undo.
- Accounts can have a low-balance warning amount; Accounts and Overview flag any account projected to fall below it in the next 30 days.
- Updating an account's balance by hand records the difference as a Balance adjustment in its transactions, so manual changes stay visible in the history.
- The Scheduled screen can be filtered to one account and to payments, income or transfers; an account page's Manage link opens it filtered to that account.
- An account's nickname, type, subtype, interest rate and currency can be changed from Edit on its page.

### Changed

- CSV import recognises transactions already posted from a schedule and no longer duplicates them; each match can be switched off in the preview.
- The savings Projections window now uses the same projection as account pages, including scheduled transfers and AER interest.
- The guide and docs now cover scheduled transactions, automatic posting and the account page; the guide's Subscriptions page is now Scheduled (old links still open it).
