# Changelog

All notable changes to PiLedger are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Entries are concise and user-facing; commit history and the originating PR hold the file-level detail.
Releases before the current cycle live in [CHANGELOG-ARCHIVE.md](CHANGELOG-ARCHIVE.md).

---

## [Unreleased]

### Changed

- README updated to reflect the envelope budget, goal projections, and set-aside-from-net-worth features.
- Frontend now has a Vitest + React Testing Library suite alongside the existing pytest backend suite. CI runs both, and new features must come with new tests on the side they touch (see CLAUDE.md "Testing requirements").

### Added

- The Overview dashboard now shows loading skeletons while your data is fetched, instead of briefly flashing misleading £0.00 / 0% values and an empty chart frame. Placeholders reserve the real content's space so the layout doesn't jump when data arrives, and the shimmer respects `prefers-reduced-motion`.
- Settings now has an "Export my data" button that downloads all your accounts, transactions, budgets, and goals as a JSON file (wires up the previously orphaned `/api/export` endpoint).
- Switching pages now plays a smooth stagger cascade — the top-level cards on each screen fade and rise in sequence, with `prefers-reduced-motion` honoured for instant transitions.
- Overview net-worth hero now shows the percentage change over the selected chart range as a colour-coded pill (green up / red down) next to the net-position figure, and it tracks the hovered point on the trend line.
- Accounts can be set aside from your net-worth headline, so day-to-day balances aren't swamped by large investment or pension swings. The Overview now shows your "Accessible" net worth (counting accounts only) with a dedicated "Set aside" card, while the Accounts page keeps the full "Total net worth" and badges set-aside accounts. Toggle "Count toward net worth" when adding or editing an account.

### Fixed

- Overview "Distribution" donut is now accessible to keyboard and screen-reader users: the chart itself is announced as a single labelled image, and an interactive legend (with a total) lets you focus or hover each account to highlight its slice. A no-assets empty state with an "Add an account" link replaces the blank chart frame.
- Overview dashboard text now meets WCAG AA contrast in light mode: muted labels, transaction amounts, and the green/red up-down figures were too faint to read, so the colour tokens have been darkened to clear the 4.5:1 readability threshold (dark mode already passed).
- The Overview "net position" pill now turns red when your assets minus debts is negative, instead of always showing green regardless of sign.
- Settings → Exchange rates: saving a rate now reliably shows "Exchange rates saved" and keeps the value you entered, even if the page re-renders right after navigating to Settings.
- "Safe to spend" on the Budget page now updates as soon as you log a transaction in an enveloped category, instead of showing a stale figure until the cache refreshes; its "about £X/day" pacing sentence now shows in the Weekly and Yearly views too, not just Monthly. New budget groups now default to Flexible so safe-to-spend works out of the box; when all groups are Fixed the card shows an explanatory hint instead of a silent £0.
- Budget income lines can now be named (e.g. "Salary") instead of a fixed "New income" placeholder: "Add income" opens a modal for the name and monthly amount, and clicking an income line lets you rename it, change the amount, or delete it. Add a second line (e.g. "Bonus") for months with extra income.
- Accounts page now classifies loan and credit accounts as debts by account type rather than balance sign, so a loan with a positive recorded balance correctly appears under the "Debts" filter and counts toward the debt total — matching how Overview and net worth already treat it.
- Accounts page "All" filter now shows total net worth in the corner, matching the figure on Overview, instead of a static hint.
- The "Add transaction" amount field no longer needs a leading "-" for expenses, which mobile decimal keypads can't type: an Expense/Income toggle now sets the sign, so the amount itself is always entered as a positive number.

## [3.1.0] — 2026-06-04

### Added

- Goal projections: a "Projections" view on the Goals screen charts each savings goal's balance forward from its monthly contribution and any linked-account interest, with colour-coded chips to filter to specific goals.
- Account subtype and interest rate fields when creating an account — the type selector is now a dropdown, a contextual subtype dropdown follows it (e.g. Cash ISA, Regular Saver, Fixed Term Bond for savings; Mortgage, Overdraft for loans), and an optional interest rate field records the account's % p.a.
- Documentation link in Settings — signed-in users can reopen the built docs (`/guide`) without logging out.
- Multi-currency end to end: account currency picker, manual FX-rate editor, and a missing-rate warning on Overview. Wires up the previously orphaned `/api/rates` endpoints so net worth no longer treats unconvertible foreign balances as 1:1.

### Changed

- Changelog handling slimmed down: entries are now concise one-liners (no affected-file lists or root-cause essays), released history moved to `CHANGELOG-ARCHIVE.md`, and the `CLAUDE.md` guidance updated to match so the bulky history is no longer loaded into context on every change.
- Split the 453-line `Settings` screen into per-section card components under `components/settings/` (Appearance, Categories, Exchange rates, Change password, Help, Session, Danger zone) behind a shared `SettingsCard` wrapper. No behaviour change; the screen is now a ~20-line shell.
- Documented every Python function in `src/` (docstring coverage 36% → 100%), explaining intent and edge cases in the existing prose style, and added a ruff rule (D102/D103, tests exempt) so new public functions and methods must carry a docstring.

### Fixed

- Mobile no longer zooms in when opening the add/edit transaction, goal, account, and transfer modals. The form fields render below iOS Safari's 16px focus-zoom threshold, and the existing guard couldn't override their CSS-module class size; it now forces 16px on touch widths.
- Removed two phantom chart rows (savings projection, account balance) from the frontend docs — neither chart exists in the React frontend.
- Transaction search now treats `%` and `_` as literal characters instead of wildcards, so searches like "50%" only match what you typed.
- Switching your base currency to one you have no rate for is now rejected with a clear message instead of silently wiping your whole exchange-rate table.
- Amounts ending in a half-cent (e.g. 2.675) no longer lose a penny on save — money is now rounded on the value entered rather than its binary-float approximation.
- Concurrent requests no longer fail with "database is locked": connections now wait on a lock (5s busy timeout) and use WAL journaling so reads stay responsive during a write.
