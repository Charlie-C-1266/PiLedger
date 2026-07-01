# Changelog

All notable changes to PiLedger are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Entries are concise and user-facing; commit history and the originating PR hold the file-level detail.
Releases before the current cycle live in [CHANGELOG-ARCHIVE.md](CHANGELOG-ARCHIVE.md).

---

## [Unreleased]

### Added

- A Subscriptions page tracks recurring payments and standing orders, showing upcoming renewal dates as a time-ordered list and an interactive, scrollable month calendar; each subscription can be colour-coded and optionally linked to an account.
- Transactions can now be bulk-imported from a bank/card CSV export: pick the target account, confirm which column is which (with a suggested mapping pre-filled), and import — re-uploading an overlapping export skips rows already imported instead of duplicating them.

### Changed

- Page transitions now slide each top-level card in from the right in sequence, replacing the fade-and-rise cascade.
- Add/edit dialogs now appear with a centred fade-and-scale and fade back out on close, replacing the instant desktop pop-in and the mobile bottom sheet; the entrance collapses to a plain fade under `prefers-reduced-motion`, and every dialog now closes on Escape.

### Fixed

- The mobile bottom navigation no longer overflows the screen now that it holds seven destinations: the tab bar scrolls horizontally when the tabs don't all fit and keeps the active tab in view.
- Views now refresh straight after the change that affects them: adding a transaction updates the net-worth trend, editing an exchange rate updates budget spending, and recording a balance updates the account-history chart and savings projections — previously some of these stayed stale until a reload or navigation.

## [3.2.0] — 2026-06-14

### Changed

- The dashboard's range, account-layout, and account-type pickers are now one shared segmented control: each option grows to a 44px touch target on phones (the net-worth range picker was previously ~21px tall — the only way to change the range on mobile), all expose proper radio-group semantics to screen readers, and every interactive control now shows a consistent keyboard focus ring.
- README updated to reflect the envelope budget, goal projections, and set-aside-from-net-worth features.
- Frontend now has a Vitest + React Testing Library suite alongside the existing pytest backend suite. CI runs both, and new features must come with new tests on the side they touch (see CLAUDE.md "Testing requirements").
- The Playwright end-to-end browser suite now runs in CI (against a freshly built SPA), so a broken e2e test surfaces as a failed check instead of slipping past review.
- Documentation refreshed to match the current code: theming is described as client-side (five accents, remembered in the browser), the database doc gains the `counts_to_net_worth` set-aside column and its v8 migration, and stale references (React Router version, the removed `esc()` helper, the missing frontend test suite) were corrected.

### Added

- A "Budgeting" guide in the documentation explains zero-based / envelope budgeting and how to set it up, with a quick link to it from the Budget page header for anyone new to the method.
- The Accounts page now charts every account's balance over time, with a 7D/30D/90D/1Y range picker, so you can see how each balance has moved (wires up the previously orphaned `/api/history/all` endpoint).
- The Overview dashboard now shows loading skeletons while your data is fetched, instead of briefly flashing misleading £0.00 / 0% values and an empty chart frame. Placeholders reserve the real content's space so the layout doesn't jump when data arrives, and the shimmer respects `prefers-reduced-motion`.
- Settings now has an "Export my data" button that downloads all your accounts, transactions, budgets, and goals as a JSON file (wires up the previously orphaned `/api/export` endpoint).
- A "Savings projections" modal, opened from the Overview net-worth card, charts each savings account's compound-interest growth and shows its projected 1-, 2-, and 5-year balances (wires up the previously orphaned `/api/projections` endpoint).
- Switching pages now plays a smooth stagger cascade — the top-level cards on each screen fade and rise in sequence, with `prefers-reduced-motion` honoured for instant transitions.
- Overview net-worth hero now shows the percentage change over the selected chart range as a colour-coded pill (green up / red down) next to the net-position figure, and it tracks the hovered point on the trend line.
- Accounts can be set aside from your net-worth headline, so day-to-day balances aren't swamped by large investment or pension swings. The Overview now shows your "Accessible" net worth (counting accounts only) with a dedicated "Set aside" card, while the Accounts page keeps the full "Total net worth" and badges set-aside accounts. Toggle "Count toward net worth" when adding or editing an account.

### Removed

- Removed the unused server-side colour-theme model: `/api/prefs` no longer stores or returns `theme` / `dark_mode` (the app already remembers your accent and light/dark choice in your browser), and the vestigial `users.theme` / `users.dark_mode` columns are dropped on upgrade.

### Fixed

- Transactions on credit card and loan accounts now move the balance in the correct direction: an expense increases what's owed and a payment/refund reduces it, matching how those balances are shown elsewhere (e.g. the net-worth summary).
- Overview "Distribution" donut is now accessible to keyboard and screen-reader users: the chart itself is announced as a single labelled image, and an interactive legend (with a total) lets you focus or hover each account to highlight its slice. A no-assets empty state with an "Add an account" link replaces the blank chart frame.
- Overview dashboard text now meets WCAG AA contrast in light mode: muted labels, transaction amounts, and the green/red up-down figures were too faint to read, so the colour tokens have been darkened to clear the 4.5:1 readability threshold (dark mode already passed).
- The Overview "net position" pill now turns red when your assets minus debts is negative, instead of always showing green regardless of sign.
- Settings → Exchange rates: saving a rate now reliably shows "Exchange rates saved" and keeps the value you entered, even if the page re-renders right after navigating to Settings.
- "Safe to spend" on the Budget page now updates as soon as you log a transaction in an enveloped category, instead of showing a stale figure until the cache refreshes; its "about £X/day" pacing sentence now shows in the Weekly and Yearly views too, not just Monthly. New budget groups now default to Flexible so safe-to-spend works out of the box; when all groups are Fixed the card shows an explanatory hint instead of a silent £0.
- Budget income lines can now be named (e.g. "Salary") instead of a fixed "New income" placeholder: "Add income" opens a modal for the name and monthly amount, and clicking an income line lets you rename it, change the amount, or delete it. Add a second line (e.g. "Bonus") for months with extra income.
- Accounts page now classifies loan and credit accounts as debts by account type rather than balance sign, so a loan with a positive recorded balance correctly appears under the "Debts" filter and counts toward the debt total — matching how Overview and net worth already treat it.
- Accounts page "All" filter now shows total net worth in the corner, matching the figure on Overview, instead of a static hint.
- The "Add transaction" amount field no longer needs a leading "-" for expenses, which mobile decimal keypads can't type: an Expense/Income toggle now sets the sign, so the amount itself is always entered as a positive number.
