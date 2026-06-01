# Changelog

All notable changes to PiLedger are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Removed

- **Retired the orphaned `budget_items` model and its `/api/budget*` endpoints.** These backed an old recurring-cash-flow "Budget Planner" plus a balance/net-worth projection, but the React rebuild left them with no frontend caller (see the Orphaned Endpoints audit), and they squat on the `/api/budget` namespace needed for the upcoming zero-based envelope **Budget** screen. Removed `GET/POST/PUT/DELETE /api/budget` and `GET /api/budget/projection` (the whole `src/routers/budget.py`), the `BudgetItemIn/Patch/Out` schemas, and the now-unused `Frequency` type alias + `FREQ_TO_MONTHLY` map in `constants.py`. A new schema-version-6 migration (plus the idempotent legacy step) drops the `budget_items` table, and it is removed from `USER_SCOPED_TABLES`; existing budget-item rows are discarded. The savings projection at `/api/projections` (a separate dashboard route) is unaffected. Affected files: `src/routers/budget.py` (deleted), `src/app.py` (router unwired), `src/schemas.py` (budget schemas removed), `src/constants.py` (`Frequency`/`FREQ_TO_MONTHLY` removed), `src/db.py` (`_migrate_to_6` + legacy drop, `SCHEMA_VERSION` 5→6, `USER_SCOPED_TABLES`), `tests/test_budget.py` (deleted), `tests/test_loans.py` (projection tests removed), `tests/test_export.py` + `tests/test_delete_me.py` + `tests/test_migrations.py` + `tests/test_route_table.py` (updated), `docs/api-reference.md`, `docs/database.md`, `docs/backups.md`.

### Added

- **Budget hero — "Left to budget" + period toggle + allocation balance bar + stat row (frontend).** Builds the top of the Budget screen's left column. A `Hero` card now leads the populated screen with the zero-based headline figure `|income − allocated|` and shifts colour + copy across three states: **under** (amber `--pl-warn`, "Left to budget" — money still to assign), **exactly zero** (green, "Every pound assigned", with a check badge), and **over** (red, "Over budget" — allocated more than earned). Below it, an allocation **balance bar** renders one colour segment per envelope group (width = group total ÷ income, with a red 45° hatch when over-allocated) and an inline **Income / Allocated / Left** stat row, the last tinted by the hero state. A segmented **Monthly / Weekly / Yearly** `PeriodToggle` (factor ×1 / ×(12⁄52) / ×12, display-only — stored figures stay monthly) sits top-right and rescales every money figure on the screen, including the interim income/group placeholder lists. Supporting additions: a `--pl-warn` amber theme token (light `#C8861A` / dark `#F5B544`), an optional `{ decimals }` argument on `fmt()` for whole-pound display, and a `CheckIcon`. Affected files: `frontend/src/components/budget/Hero.tsx` + `Hero.module.css` (new), `frontend/src/components/budget/PeriodToggle.tsx` + `PeriodToggle.module.css` (new), `frontend/src/components/budget/period.ts` (new — `Period` type + factors), `frontend/src/screens/Budget.tsx` (period state + derived totals + hero wiring), `frontend/src/theme/tokens.ts` + `frontend/src/theme/ThemeProvider.tsx` (`--pl-warn`), `frontend/src/lib/currency.ts` (`fmt` decimals option), `frontend/src/components/icons/index.tsx` (`CheckIcon`).

- **Budget screen scaffold + data layer (frontend).** Adds the fifth nav screen, **Budget**, between Transactions and Goals: a `/budget` route, sidebar + mobile tab-strip entries, and a clock-style `BudgetIcon`. A new `Budget.tsx` screen renders the live `GET /api/budget` payload — an empty state with "Add income" / "Add group" actions for a fresh budget, or a placeholder list of income lines and envelope groups (with spent/budgeted) once populated. The two no-argument add actions are wired so the screen is demoable end-to-end; the designed hero / income card / group cards / right rail / trend land in the following phases and replace the placeholder blocks. Establishes the data layer they'll all use: `Budget`/`BudgetGroup`/`BudgetEnvelope`/`BudgetIncome`/`BudgetHistoryPoint` types, `api/client.ts` functions for the full budget surface, and a `useBudget` query hook plus create/update/delete mutation hooks for income, groups, and envelopes (each invalidating the `["budget"]` query). The backend SPA shell route list gained `/budget` too, so a refresh or deep-link to the page serves the app rather than 404ing. Affected files: `frontend/src/types.ts`, `frontend/src/api/client.ts`, `frontend/src/hooks/useBudget.ts` (new), `frontend/src/screens/Budget.tsx` + `Budget.module.css` (new), `frontend/src/App.tsx`, `frontend/src/components/Sidebar.tsx`, `frontend/src/components/TabStrip.tsx`, `frontend/src/components/icons/index.tsx`, `src/routers/pages.py` (SPA route), `tests/test_route_table.py` (snapshot).

- **Envelope CRUD for the envelope budget — backend now feature-complete (no UI yet).** Adds `POST/PUT/DELETE /api/budget/envelopes[/{id}]`, completing the budget backend. Each envelope pins to one transaction `category`; on create/update the `category` is validated to be a real category for the user (a built-in default or one of their custom `user_categories`, else `422`) and the `group_id` to be an owned group (else `404`), and the `UNIQUE(user_id, category)` constraint is surfaced as `409` ("category already enveloped") so spend can't be double-counted. `PUT` can also move an envelope to another owned group and reorder via `sort_order`; new envelopes append. The envelope output schema was split like the group one — a bare `BudgetEnvelopeOut` (CRUD representation) and a `BudgetEnvelopeDetailOut(BudgetEnvelopeOut)` that adds the live `spent` for the `GET /api/budget` aggregate. Affected files: `src/routers/budget.py` (envelope CRUD + `_envelope_to_out` / `_require_owned_group` / `_require_category` helpers), `src/schemas.py` (`BudgetEnvelopeIn/Patch`, `BudgetEnvelopeOut`/`BudgetEnvelopeDetailOut` split), `tests/test_budget.py` (create/nest-with-spent, custom category, unknown-category 422, duplicate 409, group ownership 404, update/move/reorder, delete + isolation), `tests/test_route_table.py` (3 new routes), `docs/api-reference.md`.

- **Income and group CRUD for the envelope budget (no UI yet).** Adds `POST/PUT/DELETE /api/budget/income[/{id}]` and `POST/PUT/DELETE /api/budget/groups[/{id}]` so income lines and envelope groups can be created, edited, reordered (`sort_order`), and deleted — new rows append to the end of the user's list. Deleting a group cascades its envelopes (FK `ON DELETE CASCADE`, with `db()` running `foreign_keys=ON`). All routes are ownership-scoped (a row owned by another user returns `404`) and validate input: label/name length (1–120), `amount` bounds (≥ 0, ≤ MAX_MONEY), and `#rrggbb` hex colours. The group output schema was split — a bare `BudgetGroupOut` (the CRUD representation) and a `BudgetGroupDetailOut(BudgetGroupOut)` that adds `envelopes[]` for the `GET /api/budget` aggregate. Envelope CRUD lands next. Affected files: `src/routers/budget.py` (CRUD handlers + row mappers + `_next_sort_order`), `src/schemas.py` (`BudgetIncomeIn/Patch`, `BudgetGroupIn/Patch`, `BudgetGroupOut`/`BudgetGroupDetailOut` split), `tests/test_budget.py` (income + group CRUD: create/append, update, delete, 404, isolation, cascade, validation), `tests/test_route_table.py` (6 new routes), `docs/api-reference.md`.

- **`GET /api/budget` read API for the zero-based envelope budget (no UI yet).** Returns everything the Budget screen renders: `incomes[]`, `groups[]` (each nesting its `envelopes[]`), a 6-month `history[]`, plus `base_currency` and `missing_rates`. Budgeted and income figures are user-entered monthly amounts (exposed in pounds); each envelope's `spent` is computed live as the sum of the **current month's** negative transactions in that envelope's `category`, converted to the user's base currency via `services/currency` (missing rates fall back to 1.0 and are surfaced in `missing_rates`, mirroring `/api/summary`). The trend `history` compares each of the last six months' actual spend against the *current* total allocation as a flat reference line (historical plans aren't snapshotted), and is empty when the user has no envelopes. Income/group/envelope CRUD lands in later phases; this rebuilds `src/routers/budget.py` (the name freed up by retiring `budget_items`) and re-wires it into `app.py`. Affected files: `src/routers/budget.py` (new), `src/schemas.py` (`BudgetOut`/`BudgetGroupOut`/`BudgetEnvelopeOut`/`BudgetIncomeOut`/`BudgetHistoryPoint`), `src/app.py` (router re-included), `tests/test_budget.py` (new), `tests/test_route_table.py` (snapshot), `docs/api-reference.md`.

- **Database schema for the zero-based envelope budget (no API or UI yet).** Lays the data foundation for the upcoming **Budget** screen. Three new user-scoped tables are created (integer-cents money, monthly figures): `budget_income` (manual income lines), `budget_group` (envelope groups; a `flexible` flag drives the future "safe to spend" calc), and `budget_envelope` (one envelope per group, each tracking a single transaction `category` for live spend, with `UNIQUE(user_id, category)` so a category can't be double-counted). All three cascade-delete with the user (and envelopes cascade with their group), and are registered in `USER_SCOPED_TABLES` so `GET /api/export` and `DELETE /api/auth/me` automatically include/clear them. Added as schema version 7 via `_migrate_to_7`, with the table DDL shared between `init()` and the migration to prevent drift. Affected files: `src/db.py` (`_BUDGET_TABLES_DDL`, `_migrate_to_7`, `SCHEMA_VERSION` 6→7, `USER_SCOPED_TABLES`, `init()`), `tests/test_migrations.py` (fresh + legacy creation, FK/user cascade, UNIQUE-category coverage), `docs/database.md`.

- **The header search button is now functional — searches accounts, goals, and transactions.** The "Search" pill in the desktop header was a static, non-interactive `<div>` (and there was no search affordance at all on mobile), so clicking it did nothing. It now opens a command-palette overlay: typing matches your accounts and goals by name (filtered client-side from the already-cached lists) and your transactions by merchant/note (server-side via the existing `GET /api/transactions?search=` param, debounced 200 ms and capped at 8 rows). Results are grouped under Accounts / Goals / Transactions, navigable by mouse or ↑/↓ + Enter, and dismissable with Esc or a backdrop click. Selecting a result jumps to the relevant screen — a transaction deep-links to `/transactions?q=<term>` so the Transactions list opens pre-filtered to that search. A matching search button was also added to the mobile header. Affected files: `frontend/src/components/SearchModal.tsx` (new), `frontend/src/components/SearchModal.module.css` (new), `frontend/src/components/Header.tsx` (search pill → button, `onSearch` prop, mobile search button), `frontend/src/components/Header.module.css` (button reset + hover on the pill), `frontend/src/components/Shell.tsx` (search overlay state + wiring), `frontend/src/screens/Transactions.tsx` (seed the search box from the `?q=` deep-link param).

### Fixed

- **Hardcoded `/home/charlie/` paths removed from documentation.** The bare-metal sections of `docs/deployment.md` and `docs/backups.md` contained absolute paths specific to the original development environment (`/home/charlie/git/piledger`, `/home/charlie/backups/`). These have been replaced with generic placeholders (`/path/to/piledger`, `/path/to/backups/`) so the documentation works for any installation. The example restore filename has also been generalised from a hardcoded date to `piledger-YYYY-MM-DD.db`. Affected files: `docs/deployment.md`, `docs/backups.md`.

### Changed

- **Accounts page now shows a single filterable list instead of three separate sections.** The page previously rendered "All accounts", "Assets", and "Debts" sections simultaneously, causing every account to appear at least twice and making the page confusing. All three sections are replaced by one unified list with an All / Assets / Debts pill filter above it; selecting "Assets" or "Debts" shows the running total in the matching colour; "All" restores the "Click to update balance" hint. Affected files: `frontend/src/screens/Accounts.tsx`, `frontend/src/screens/Accounts.module.css`.

- **Began splitting the 1,656-line `src/app.py` into per-resource routers + shared services (refactor stage 1 of 8).** `app.py` had grown to mix app setup, ~36 route handlers, shared business helpers and SPA serving in one hard-to-review file. This first stage lands the scaffolding and proves the pattern on one low-risk router, with no behaviour change. The shared `Limiter` moved to `src/limiter.py` so routers can apply `@limiter.limit(...)` without importing `app` (which would cycle); the FX helpers (`_load_rates`, `_rescale_rates`, `_convert_to_base`) moved to `src/services/currency.py` and the account helpers (`_adjust_account_balance`, `_require_account`) to `src/services/accounts.py`; and the categories endpoints moved into `src/routers/categories.py` as an `APIRouter` mounted via `include_router` before the SPA routes. `app.py` re-exports `app`/`init`/`limiter` so the test suite needs no change. A new route-table snapshot test (`tests/test_route_table.py`) freezes the full set of `(path, method)` pairs as the migration safety net. Affected files: `src/limiter.py` (new), `src/services/__init__.py` + `currency.py` + `accounts.py` (new), `src/routers/__init__.py` + `categories.py` (new), `src/app.py` (helpers/limiter/categories removed, router included), `tests/test_route_table.py` (new).

- **Moved the static-serving and ops/docs endpoints out of `src/app.py` into routers (refactor stage 2 of 8).** Continuing the split, the lowest-risk routes — which carry no business logic — moved next. `src/routers/ops.py` now owns `/healthz`, the auth-gated `/api/openapi.json` + `/docs` + `/redoc`, the public `/guide`, and `/api/docs/{slug}`; `src/routers/pages.py` owns the SPA shell (`/`, `/overview`, `/accounts`, `/transactions`, `/goals`, `/settings`) plus the public `/manifest.json` and `/icons/{name}`. The OpenAPI route reaches the app via `request.app.openapi()` so the router never imports `app`. The static-dir resolution moved from a private `_STATIC_DIR` in `app.py` to a shared `constants.STATIC_DIR` (alongside the existing `DOCS_DIR`), since the ops, pages and still-inline `/login` routes plus the `/static` mount all need it; the `/healthz` boot-clock moved into `ops.py`. `pages` is included last so a page route can never shadow an API path. No behaviour change; the route-table snapshot is unchanged. Affected files: `src/routers/ops.py` (new), `src/routers/pages.py` (new), `src/constants.py` (`STATIC_DIR`), `src/app.py` (ops/pages routes removed, routers included, `/login` + mount use `STATIC_DIR`).

- **Moved the auth, account-lifecycle and data-export endpoints out of `src/app.py` into a router (refactor stage 3 of 8).** `src/routers/auth.py` now owns the `/login` page, all six `/api/auth/*` routes (register, login, logout, me, password change, account deletion) and `/api/export`. The rate-limited `POST /api/auth/login` keeps its `@limiter.limit(...)` decorator and `Request` parameter — the limiter is imported from `src/limiter.py`, so the router never imports `app`, while `app.state.limiter` and the exception handler stay registered in `app.py` so rate limiting still fires. The router module is named `routers/auth.py`; its `from auth import ...` still resolves to the top-level `src/auth.py` (hashing/sessions) because Python 3 absolute imports key off the full module name (`routers.auth`). No behaviour change; the route-table snapshot is unchanged. Affected files: `src/routers/auth.py` (new), `src/app.py` (auth/export routes + now-unused imports removed, router included via `from routers import auth as auth_router`).

- **Moved the accounts and balance-history endpoints out of `src/app.py` into a router (refactor stage 4 of 8).** `src/routers/accounts.py` now owns the accounts CRUD (`GET`/`POST /api/accounts`, `PUT`/`DELETE /api/accounts/{aid}`) plus the per-account balance routes (`POST /api/accounts/{aid}/balance`, `GET /api/accounts/{aid}/history`). The `_account_row_to_out` mapper moved with it, staying private to the router since only `list_accounts` uses it. The shared balance helpers (`_adjust_account_balance`, `_require_account`) already live in `services/accounts.py` (stage 1) and these routes don't use them, so nothing else moved. No behaviour change; the route-table snapshot is unchanged. Affected files: `src/routers/accounts.py` (new), `src/app.py` (accounts/balance routes + now-unused imports removed, router included).

- **Moved the transactions and transfers endpoints out of `src/app.py` into a router (refactor stage 5 of 8).** `src/routers/transactions.py` now owns `GET`/`POST /api/transactions`, `PUT`/`DELETE /api/transactions/{tid}`, and `POST /api/transfers` — including the transfer's two-linked-leg create, the delete-both behaviour, and the transfer-leg edit guard. The `_TXN_SORT_MAP` sort whitelist and `_txn_row_to_out` mapper moved with it (private to the router). Balance side effects continue to go through `services/accounts._adjust_account_balance`, now imported by the router rather than `app.py`; with transactions gone, `app.py` imports only `_require_account` from that service (still used by goals). No behaviour change; the route-table snapshot is unchanged. Affected files: `src/routers/transactions.py` (new), `src/app.py` (transactions/transfers routes + now-unused imports removed, router included).

- **Moved the dashboard read endpoints out of `src/app.py` into a router (refactor stage 6 of 8).** `src/routers/dashboard.py` now owns the aggregate reads — `GET /api/summary`, `GET /api/history/all`, `GET /api/history/networth`, and `GET /api/projections` — each of which builds its response inline (no shared mappers to move). Cross-currency totals still convert via `services/currency` (`_load_rates`, `_convert_to_base`), now imported by the router; those helpers stay imported in `app.py` too since budget's projection endpoint also uses them. No behaviour change; the route-table snapshot is unchanged. Affected files: `src/routers/dashboard.py` (new), `src/app.py` (dashboard routes + now-unused imports removed, router included).

- **Moved the last four route groups — goals, budget, preferences, exchange rates — out of `src/app.py` into routers (refactor stage 7 of 8).** `src/routers/prefs.py` (`/api/prefs`, using `services/currency._rescale_rates` when the base currency changes), `src/routers/rates.py` (`/api/rates`), `src/routers/budget.py` (`/api/budget*` incl. the projection that uses `services/currency._load_rates`/`_convert_to_base` and `FREQ_TO_MONTHLY`), and `src/routers/goals.py` (`/api/goals*`, using `services/accounts._require_account`). Their private mappers `_prefs_out`, `_budget_row_to_out` and `_goal_row_to_out` moved with them. With these gone, `app.py` holds no route handlers at all — it's now a ~100-line wiring module (FastAPI construction, middleware, the 400 validation handler, `init()`, and the `include_router` calls), and no longer imports `db`/`schemas`/`services`/`auth` route plumbing. No behaviour change; the route-table snapshot is unchanged. Affected files: `src/routers/prefs.py` + `rates.py` + `budget.py` + `goals.py` (new), `src/app.py` (all remaining routes + now-unused imports removed, routers included).

- **Documented the new backend layout and finished the `src/app.py` refactor (stage 8 of 8 — final trim + docs).** With all routes now living in `src/routers/` and shared logic in `src/services/`, the documentation that still described `app.py` as the home of every route was updated to match: `docs/architecture.md` (the request-flow diagram, the backend prose, and the `src/` file-structure tree now show `routers/`, `services/` and `limiter.py`) and CLAUDE.md's "Stack" section (a new "Backend layout" bullet describing the thin-`app.py` + routers + services structure and the no-`app`-import rule). `app.py`'s own module docstring was rewritten to describe it as the wiring module. No code behaviour change. This completes the 8-stage split: `app.py` is a 100-line wiring module, every route lives in a per-resource router, there are no import cycles, and `tests/test_route_table.py` guards the route surface. Affected files: `docs/architecture.md`, `CLAUDE.md`, `src/app.py` (docstring only).

### Added

- **Goals can be edited, deleted, and linked to an account for automatic tracking.** Goals previously could only be created and have their monthly contribution nudged via a slider — there was no way to rename one, change its target/colour, delete it, or tie it to real money. Each goal card now has an **Edit** button opening a modal to change the name, target, monthly contribution, colour, and (new) a **linked account**, plus a **Delete** action. When a goal is linked to an account (e.g. an emergency fund → a savings account), its progress **auto-tracks that account's current balance** live — the manual "already saved" field is hidden for linked goals; unlinked goals keep a manually-entered amount as before. Deleting a linked account unlinks its goals (via `ON DELETE SET NULL`) rather than deleting them. Backend: nullable `goals.account_id` (schema v5 migration, idempotent on fresh/stamped/legacy DBs); `GoalOut` gains `account_id`/`account_name` and a linked goal's `saved` is derived from the account's latest balance; create/update validate account ownership and `PUT` switched to `exclude_unset` so an explicit `account_id: null` unlinks. Affected files: `src/db.py` (migration + column), `src/schemas.py` (`GoalIn`/`GoalPatch`/`GoalOut`), `src/app.py` (goal endpoints + derived `saved`), `tests/test_goals.py`, `docs/api-reference.md`, and frontend `AddGoalModal.tsx` (edit/delete/account picker), `screens/Goals.tsx` + `.module.css`, `api/client.ts`, `types.ts`.

## [2.1.0] — 2026-05-29

### Changed

- **More breathing room below the Add transaction / Add goal modal titles.** The first field sat directly under the heading, which read as cramped. A small gap (16 px) is now added when a field follows the title directly; modals that have a subtitle (Transfer, Update account) are unaffected. Affected files: `frontend/src/components/AddModal.module.css`.

- **In-app logo now matches the app/tab icon.** The top-left brand badge (in the desktop sidebar and the mobile header) showed a placeholder letter "P" on the accent square, while the browser-tab favicon and installed-app icon use the white upward chart-line mark. The badge now renders that same chart-line mark, so the in-app logo and the tab/home-screen icon are consistent. Implemented as a new `LogoMark` SVG (a bolder-stroke version of the `icon-192` artwork) dropped into the existing accent `.logo` box, inheriting white via `currentColor`. Affected files: `frontend/src/components/icons/index.tsx` (new `LogoMark`), `frontend/src/components/Sidebar.tsx`, `frontend/src/components/Header.tsx`.

### Fixed

- **The Overview "+ Add transaction" button did nothing.** The button in the Recent activity header had no click handler, so tapping it was a no-op. It now opens the Add transaction modal (the same one reachable from the global "+" menu and the Transactions screen), defaulting to the first account; on save the Recent activity list and balances refresh. Affected files: `frontend/src/screens/Overview.tsx`.

- **Net-worth chart hover stopped updating the value, and never showed the date.** Hovering the Overview net-worth chart no longer refreshed the hero figure to the value under the cursor. Root cause: the chart was upgraded to recharts v3, where the chart-level mouse-move state reports `activeTooltipIndex` as a **string** (`TooltipIndex = string | null`) rather than a number; `LineChart`'s `onMouseMove`/`onTouchMove` still guarded with `typeof … === "number"`, so the guard never matched and `onHover` never fired — leaving the hero pinned to the current total. The index is now coerced and bounds-checked, restoring the live value on hover (and touch-drag). In the same pass the chart's tooltip — previously rendered as `() => null` — now shows a small pill with the **date** and value at the hovered point, so the point in time is visible on the graph. Affected files: `frontend/src/components/charts/LineChart.tsx`.
- **Net-worth chart plotted higher than the headline net-worth figure when debts were recorded as negative balances.** The chart series (`GET /api/history/networth`) subtracted liabilities with `nw -= converted`, taking the balance at face value. A debt recorded as a negative number (e.g. `-2000` for "owe 2,000") therefore flipped sign and was *added* to net worth, so the chart drifted above the hero value (which comes from `/api/summary`, where debts are normalised with `abs()` before being subtracted). The chart now subtracts `abs(converted)` for `loan`/`credit` accounts, matching the summary convention regardless of how the balance was signed. Added `test_networth_negative_debt_balance_matches_summary` asserting the chart's last point equals `summary.total`. Affected files: `src/app.py` (`networth_history`), `tests/test_dashboard.py`.

### Added

- **"+ Add goal" button on the Overview Goals progress section.** The Goals progress card had no quick way to add a goal from the Overview. It now has a "+ Add goal" pill in its header — matching the style of Recent activity's "+ Add transaction" — that opens the Add goal modal; the goals list refreshes on save. Affected files: `frontend/src/screens/Overview.tsx`.

- **Transfer money between accounts.** Moving funds between your own accounts previously meant logging two opposite transactions by hand, which was fiddly and easy to get wrong (forget one side and the balances drift). A new **Transfer** option in the "+" menu opens a modal to pick a source and destination account and an amount; it's recorded as two linked transactions — `-amount` on the source, `+amount` on the destination — sharing a `transfer_id`, so both balances update and net worth is unchanged. Deleting either side removes both and reverses both balance adjustments, and the legs are shown as "Transfer to/from <account>" and can't be individually edited (the editor offers delete instead). This first version is restricted to accounts sharing a currency (the destination list filters accordingly); cross-currency transfers can follow once the FX-rate editor exists (see the orphaned-endpoints audit). Backend: new `POST /api/transfers`, a nullable `transactions.transfer_id` column (schema v4 migration, idempotent on legacy/fresh DBs), delete-both and edit-guard on the transaction routes. Affected files: `src/db.py` (migration + `transfer_id`), `src/schemas.py` (`TransferIn`, `TransactionOut.transfer_id`), `src/app.py` (`POST /api/transfers`, delete-both, PUT guard, `_txn_row_to_out`), `tests/test_transfers.py` (new), `docs/api-reference.md`, and frontend `TransferModal.tsx` (new), `AddMenu.tsx`, `Shell.tsx`, `AddModal.tsx` (transfer-leg guard), `icons/index.tsx` (`TransferIcon`), `api/client.ts`, `types.ts`.

- **Long-press to edit an account on mobile.** Tapping an account tile on the Accounts screen opened the Update Account modal immediately, but on touch devices the large tile invited double-tap-to-zoom and a stray tap could open the editor by accident — inconsistent with the transaction rows, which already require a deliberate long-press (Slice 7). Account tiles now use the **same edit gesture**: an immediate click on desktop (mouse), and a ~500 ms long-press on touch/pen with a `scale(0.985)` press-state ~150 ms in, cancelled by moving more than 10 px (scrolling). `touch-action: manipulation` plus disabled `user-select` / `-webkit-touch-callout` suppress the zoom and the OS text-selection callout. The Update Account modal itself already rendered as a mobile bottom sheet, so no positioning change was needed.

  To keep the two surfaces from drifting, the long-press logic was extracted from `TxnRow` into a shared `useLongPress` hook; `TxnRow` now consumes it (behaviour unchanged) and a small `PressableTile` wrapper applies it around each account tile. Affected files: `frontend/src/hooks/useLongPress.ts` (new), `frontend/src/components/PressableTile.tsx` + `.module.css` (new), `frontend/src/components/TxnRow.tsx` (refactored onto the hook), `frontend/src/screens/Accounts.tsx` (tiles wrapped in `PressableTile`).

- **Delete account from the Update Account modal.** There was no way to remove an account after creation, even though the backend `DELETE /api/accounts/{id}` endpoint already existed and correctly cascades deletions to linked transactions and balance history. A "Delete account" button now appears in the footer of the Update Account modal (opened by tapping any account tile). Clicking it transitions to an inline confirmation prompt — showing the account name and a warning that all transactions will be removed — before the deletion is sent. After a successful delete, the accounts, transactions, summary, and net-worth queries are all invalidated so the UI updates immediately. Affected files: `frontend/src/components/UpdateBalanceModal.tsx`, `frontend/src/api/client.ts` (new `removeAccount` export).

---

## [2.0.0] — 2026-05-28

### Added

- **Mobile UX — Slice 6: Transaction filter & search as a bottom sheet.** On mobile (< 720 px) the Transactions filter bar previously wrapped across 2–3 lines and the category chips overflowed off-screen, pushing the first transaction row below the fold on small phones. The bar now collapses to a single row: the search input (always visible) plus a **Filters** button. The button shows an accent badge counting active non-default filters (account ≠ All, category ≠ All, sort ≠ Newest) and opens a bottom sheet containing the account dropdown, a Newest/Largest sort toggle, and the category chip grid. Edits are held as a draft and committed by an **Apply** button (a **Clear all** link resets them); tapping the backdrop dismisses without applying. The inline "+ Add" button is dropped on mobile since the header already provides one. Desktop layout is unchanged.

  The sheet reuses the Slice 4 bottom-sheet pattern: `FilterSheet.module.css` composes the `backdrop` / `sheet` / `handle` (and `select` / `chip`) classes from `AddModal.module.css`, so the slide-up animation, rounded top, drag handle, and safe-area padding stay consistent.

Affected files: `frontend/src/components/FilterSheet.tsx` (new), `frontend/src/components/FilterSheet.module.css` (new), `frontend/src/components/icons/index.tsx` (new `FilterIcon`), `frontend/src/screens/Transactions.tsx` (mobile filter bar + sheet wiring, active-filter count), `frontend/src/screens/Transactions.module.css` (mobile single-row search, `filterBtn`, `filterBadge`).

- **Mobile UX — Slice 7: Long-press to edit a transaction.** Transaction rows are the primary scrollable content on mobile, and a tap that landed at the end of a scroll stutter would open the editor unintentionally. On touch (and pen) devices, opening the edit modal now requires a deliberate ~500 ms **long-press**; a plain tap no longer does anything. A press-state (background tint + `scale(0.985)`) appears ~150 ms into the hold so the press registers visibly before the modal opens, and moving more than 10 px (i.e. scrolling) cancels it. **Desktop click-to-edit is unchanged** — mouse clicks still open the editor immediately.

  Implemented with pointer events in `TxnRow`: `onPointerDown` starts the feedback + long-press timers for non-mouse pointers, `onPointerMove` past the 10 px threshold and `onPointerUp` / `onPointerCancel` / `onPointerLeave` clear them. The synthetic `click` that follows a tap or long-press is swallowed (touch edits only via hold; mouse edits via click). `user-select` / `-webkit-touch-callout` are disabled on the row so a hold doesn't trigger the OS text-selection callout.

Affected files: `frontend/src/components/TxnRow.tsx`, `frontend/src/components/TxnRow.module.css`.

- **Mobile UX — Slice 8: PWA manifest & app icon.** "No PWA manifest" was a pre-v1.0 gap versus competitors (Ghostfolio, Actual); PiLedger could not be installed to a phone's home screen. Added a web app manifest (`display: standalone`, name/short-name, `theme_color`/`background_color`, `scope`/`start_url` of `/`) and three icons — `icon-192`, `icon-512`, and a `maskable` 512 with a 10 % safe zone — rendered from the existing brand mark (the accent rounded-square with the white chart line). `index.html` gains the `<link rel="manifest">`, `apple-touch-icon`, a PNG favicon, `theme-color`, and the `apple-mobile-web-app-*` meta tags so an installed iOS/Android instance gets a proper icon, standalone window, splash, and themed app-switcher entry. Combined with Slice 3's `viewport-fit=cover`, the installed experience is now polished.

  Serving: `manifest.json` and `icons/` live in `frontend/public/` (copied into the Vite `dist/` build output) and are exposed at the root paths the manifest references via two **public** (no-auth) FastAPI routes — `GET /manifest.json` and `GET /icons/{name}` (icon names whitelisted to prevent path traversal). Both 404 until the frontend is built, mirroring how the SPA index is served.

  Affected files: `frontend/index.html`, `frontend/public/manifest.json` (new), `frontend/public/icons/icon-192.png` + `icon-512.png` + `icon-512-maskable.png` (new), `src/app.py` (public `/manifest.json` + `/icons/{name}` routes).

- **Transaction sort: Oldest and Smallest options.** The Transactions sort only offered Newest and Largest. Added **Oldest** (`occurred_at` ascending) and **Smallest** (ascending by absolute amount) so all four directions are available. On desktop the sort toggle button became a four-option dropdown; on mobile the filter sheet's sort control became a 2×2 grid of Newest / Oldest / Largest / Smallest. The backend `_TXN_SORT_MAP` gained `date_asc` and `amount_asc` keys (existing `date`/`amount` unchanged).

  Affected files: `src/app.py` (`_TXN_SORT_MAP`), `tests/test_transactions.py` (two new sort tests), `frontend/src/types.ts` (`TxnSort` type), `frontend/src/screens/Transactions.tsx` + `.module.css` (sort `<select>`, removed `sortBtn`), `frontend/src/components/FilterSheet.tsx` + `.module.css` (four sort options, 2×2 grid).

- **Accounts: Assets section.** The Accounts page highlighted Debts as their own section but had no equivalent for assets. Added a symmetric **Assets** section listing positive-balance accounts with a green total, mirroring the Debts block. Consolidated the now-shared `.debtHeader`/`.debtGrid`/`.debtTotal` styles into the existing `.sectionHeader`/`.accountGrid` plus a generic `.totalValue`.

  Affected files: `frontend/src/screens/Accounts.tsx`, `frontend/src/screens/Accounts.module.css`.

### Fixed

- **Card-stack view controls broke the layout on mobile.** The fan/cascade/wave/grid variant picker and the account-type filter pills sat inline in the section header; on narrow screens they wrapped and consumed so much width that the heading was squeezed and content shifted left. On mobile (< 720 px) these controls are now collapsed behind a single 44 px filter-icon button that opens a bottom sheet (Layout + Filter-by-type chips, with a Done button); desktop keeps the inline pickers unchanged. Extracted into a new `StackControls` component used by both the Overview and Accounts card stacks.

  Affected files: `frontend/src/components/StackControls.tsx` (new), `frontend/src/components/StackControls.module.css` (new), `frontend/src/screens/Overview.tsx` + `.module.css`, `frontend/src/screens/Accounts.tsx` + `.module.css`.

---

## [1.9.0] — 2026-05-28

### Added

- **Mobile UX — Slice 5: Chart touch events.** The custom SVG Donut (account distribution) was non-interactive on touch devices because it relied on `onMouseEnter` / `onMouseLeave`, which fire unreliably (or not at all) under touch. Segments now use pointer events and a tap-to-toggle highlight, so mobile users can explore which account owns which slice.

  **Donut.tsx:** Mouse/pen hover uses `onPointerEnter` / `onPointerLeave` (touch pointers are ignored here so a tap doesn't highlight-then-clear on finger lift). A new internal `tappedIdx` state drives a sticky highlight: tapping/clicking a segment highlights it, tapping it again — or tapping the empty chart area — clears it, and tapping a different segment moves the highlight. Hover reverts to the sticky tapped slice when the pointer leaves. For accessibility, the SVG root gains `role="img"` and a generated `aria-label` summarising every segment and its percentage (overridable via a new optional `ariaLabel` prop); each segment is keyboard-focusable (`tabIndex`, `role="button"`, `aria-pressed`, Enter/Space to toggle) with a `:focus-visible` outline.

  **LineChart.tsx:** Added `onTouchMove` / `onTouchEnd` handlers mirroring the existing mouse handlers so the net-worth hover label updates when a finger is dragged across the area chart.

Affected files: `src/constants.py` (VERSION → 1.9.0), `frontend/src/components/charts/Donut.tsx`, `frontend/src/components/charts/Donut.module.css`, `frontend/src/components/charts/LineChart.tsx`.

---

## [1.8.0] — 2026-05-28

### Added

- **Mobile UX — Slice 4: Bottom sheet modal forms.** On mobile (< 720 px), all four modal forms (Add Transaction, Add Account, Add Goal, Update Account) now slide up from the bottom of the screen rather than appearing centred, placing every input within thumb reach. Desktop behaviour is unchanged (centred card, max-width 440 px).

  A new `useIsMobile` hook (mirrors Shell's 720 px breakpoint, updates on resize) detects the layout and switches each modal between the existing centred style and the new bottom sheet. The sheet uses `align-items: flex-end` on the backdrop, rounded top corners (`border-radius: 20px 20px 0 0`), `max-height: 92vh` with vertical scroll, and a `slideUp` CSS animation (`translateY(100%) → translateY(0)`, 300 ms ease-out). A 36 × 4 px drag-handle pill appears at the top of the sheet — the standard iOS/Android affordance signalling the sheet can be dismissed. Bottom padding accounts for the device home indicator via `env(safe-area-inset-bottom, 0px)`. Tapping the backdrop still dismisses (existing behaviour).

Affected files: `src/constants.py` (VERSION → 1.8.0), `frontend/src/hooks/useIsMobile.ts` (new), `frontend/src/components/AddModal.module.css` (new `backdropMobile`, `sheet`, `handle`, `slideUp`), `frontend/src/components/AddModal.tsx`, `frontend/src/components/AddAccountModal.tsx`, `frontend/src/components/AddGoalModal.tsx`, `frontend/src/components/UpdateBalanceModal.tsx`.

---

## [1.7.0] — 2026-05-28

### Added

- **Mobile UX — Slices 1–3: iOS input zoom fix, touch target hardening, and safe area insets.** Three independently-scoped improvements that together resolve the most disruptive mobile issues on iOS and Android.

  **Slice 1 — iOS Input Zoom & Autocomplete Fix:** iOS Safari auto-zooms the viewport when a focused `<input>` has `font-size < 16px`. All form inputs were styled at 13 px. A `@media (max-width: 719px)` rule in `index.css` now sets `font-size: 1rem` on all `input`, `select`, and `textarea` elements, preventing the zoom entirely. `autoComplete` attributes added throughout: `current-password` / `new-password` on password fields in Settings, `off` on free-text fields (merchant name, account name, goal name, category name, hex colour input) to suppress unwanted suggestions. The login page already had correct `autocomplete` attributes; `login.css` gains the same `1rem` mobile font-size override.

  **Slice 2 — Touch Target Hardening:** Mobile header buttons (add, theme toggle) enlarged from 38 × 38 px to 44 × 44 px, meeting WCAG 2.5.5 and Apple/Google HIG minimums. TabStrip tabs now have `min-height: 56px` (standard bottom-navigation height). A global `touch-action: manipulation` rule on `button`, `a`, `[role="button"]`, `input`, `select`, and `textarea` eliminates the 300 ms double-tap-to-zoom delay on older Android browsers without interfering with scroll or swipe gestures.

  **Slice 3 — Safe Area Insets (iPhone Notch & Home Bar):** `viewport-fit=cover` added to the viewport meta in both `frontend/index.html` and `src/static/login.html`. The mobile header gains `padding-top: env(safe-area-inset-top, 0px)` to clear the Face ID notch. The TabStrip container gains `padding-bottom: env(safe-area-inset-bottom, 0px)` and the mobile main content gains `calc(60px + env(safe-area-inset-bottom, 0px))` bottom padding so content is never clipped by the home indicator.

Affected files: `src/constants.py` (VERSION → 1.7.0), `frontend/index.html`, `src/static/login.html`, `frontend/src/index.css`, `src/static/login.css`, `frontend/src/components/AddModal.tsx`, `frontend/src/components/AddAccountModal.tsx`, `frontend/src/components/AddGoalModal.tsx`, `frontend/src/screens/Settings.tsx`, `frontend/src/components/Header.module.css`, `frontend/src/components/TabStrip.module.css`, `frontend/src/components/Shell.module.css`.

---

## [1.6.0] — 2026-05-28

### Added

- **Expanded transaction categories.** The built-in category list has been broadened from 8 generic labels to 18, covering common income types (Salary, Freelance, Interest Earned, Benefits) and additional expense areas (Clothing, Subscriptions, Pets, Gifts, Education, Travel) alongside the existing spending categories.
- **Custom category management in Settings.** Users can now create and delete their own transaction categories from the Settings page. Custom categories appear alongside the built-in ones in the Add/Edit transaction modal. Up to 50 custom categories are supported per user; duplicate names are rejected with a clear error. Custom categories are persisted per-user in the database and included in data export and account deletion cascade.

Affected files: `src/constants.py` (VERSION bump to 1.6.0, `DEFAULT_CATEGORIES`, `MAX_CUSTOM_CATEGORIES`), `src/db.py` (SCHEMA_VERSION bump to 3, `user_categories` table, `_migrate_to_3`), `src/schemas.py` (`CategoryIn`, `CustomCategoryOut`, `CategoriesOut`), `src/app.py` (`GET/POST /api/categories`, `DELETE /api/categories/{cid}`), `frontend/src/types.ts` (`CustomCategory`, `Categories` interfaces), `frontend/src/api/client.ts` (`getCategories`, `createCategory`, `deleteCategory`), `frontend/src/hooks/useCategories.ts` (new), `frontend/src/components/AddModal.tsx` (uses hook instead of hardcoded list), `frontend/src/screens/Settings.tsx` (category management card), `frontend/src/screens/Settings.module.css` (category UI styles), `tests/test_categories.py` (new).

---

## [1.5.1] — 2026-05-28

### Fixed

- **Documentation out of sync with the codebase.** Several docs had not been updated since major features were added in v0.30.0 and the React migration. Specifically:
  - `docs/api-reference.md` was missing the full Transactions and Goals CRUD sections, the `GET /api/history/networth` endpoint, the expanded `GET /api/summary` response shape (`total_credit`, `total_invest`, `assets`, `debts`, `savings_rate`, `base_currency`, `missing_rates`), and the five named SPA routes. The `DELETE /api/auth/me` cascade list and `GET /api/export` response shape also omitted `transactions` and `goals`.
  - `docs/database.md` was missing the `exchange_rates`, `transactions`, and `goals` tables; the `accounts` table was missing the `subtype` and `currency` columns and did not list the `credit` and `invest` account types.
  - `docs/frontend.md` described the old vanilla JS / Chart.js architecture and did not mention React, TypeScript, Vite, TanStack Query, or Recharts.
  - `README.md` listed "Vanilla JS, Chart.js 4.4" in the stack table and did not mention transaction tracking, savings goals, or `credit`/`invest` account types.

Affected files: `docs/api-reference.md`, `docs/database.md`, `docs/frontend.md`, `README.md`.

---

## [1.5.0] — 2026-05-27

### Added

- **Account type filter on card stack.** Both the Overview and Accounts pages now show filter pills (All / Current / Savings / Loan / Credit / Invest) alongside the fan/cascade/wave/grid picker when the user has more than one account type. Selecting a type shows only those accounts in the stack; clicking again or "All" resets. Pills only appear for types that have at least one account.
- **Removed card stack cap.** The fan/cascade/wave/grid views previously capped at 6 accounts. All accounts are now shown regardless of count. The fan and cascade animations scale their spacing dynamically so cards don't overflow even with many accounts.

Affected files: `frontend/src/components/CardStack.tsx` (removed slice cap, adaptive spacing, new `TypeFilterPicker` component), `frontend/src/screens/Overview.tsx` (type filter inline with variant picker), `frontend/src/screens/Overview.module.css` (stackControls layout), `frontend/src/screens/Accounts.tsx` (type filter state and layout), `frontend/src/screens/Accounts.module.css` (stackControls layout).

---

## [1.4.0] — 2026-05-27

### Added

- **Edit account colour from the update modal.** Clicking an account card now shows a colour picker (same presets and hex input as the Add Account modal) alongside the balance field. Changing the colour calls `PUT /api/accounts/{id}` which was already supported by the backend but had no frontend path. The balance field remains optional — you can update just the colour, just the balance, or both.

Affected files: `frontend/src/components/UpdateBalanceModal.tsx` (colour picker UI, `updateAccount` mutation), `frontend/src/api/client.ts` (new `updateAccount` function).

---

## [1.3.4] — 2026-05-27

### Fixed

- **Hardcoded "User" in sidebar and greeting.** The "Signed in" label in the sidebar footer displayed the literal string "User" instead of the authenticated user's username, and the header greeting read "Hey there 👋" with no name. Added a `useMe` hook that calls `GET /api/auth/me`, wired it into `Shell` (which already owns the layout), and threaded the `username` down to `Sidebar` and `Header` as a new optional prop. While the API resolves, both surfaces show a neutral placeholder (`…` in the sidebar; the plain greeting in the header), so there is no flash of stale data.

Affected files: `frontend/src/hooks/useMe.ts` (new), `frontend/src/components/Shell.tsx`, `frontend/src/components/Sidebar.tsx`, `frontend/src/components/Header.tsx`.

---

## [1.3.3] — 2026-05-27

### Fixed

- **Transaction account column misalignment.** The account badge column in `TxnRow` shifted horizontally across rows because each row used its own independent CSS grid and the `amount` column was `auto`-sized — meaning rows with larger amounts pushed the account column leftward. Fixed by introducing a `.withAccount` CSS modifier that pins the account column to `120px` and the amount column to `96px`, guaranteeing identical column positions on every row. Long account names now truncate with an ellipsis; amounts are right-aligned within their fixed column.

Affected files: `frontend/src/components/TxnRow.module.css`, `frontend/src/components/TxnRow.tsx`.

---

## [1.3.2] — 2026-05-27

### Fixed

- **Test suite audit.** Added 4 tests for transaction update balance adjustment (amount change, account move, combined, and non-financial field no-op). Fixed broken e2e `test_register_then_auto_login_lands_on_dashboard` that expected an `h1` element on the React SPA overview page — now checks for "NET WORTH" text which actually exists. Added transaction seed and assertion to the export round-trip test so exported transaction data correctness is verified.

Affected files: `tests/test_transactions.py` (4 new balance-adjustment-on-update tests), `tests/e2e/test_auth_flow.py` (h1 → "NET WORTH" locator), `tests/e2e/conftest.py` (same fix in `signed_in_page` fixture), `tests/test_export.py` (transaction seed + assertion).

---

## [1.3.1] — 2026-05-27

### Added

- **Per-account colour selection.** Accounts now carry a colour that is applied
  to the card gradient and the distribution donut. A colour picker is shown in
  the Add Account modal — 12 curated presets plus a free-form hex input — and a
  live card-shaped preview updates in real time as you select.

- **`colorToGradient` helper and `PRESET_COLORS` palette** in
  `frontend/src/theme/swatches.ts`. Derives a lighter gradient-end shade from a
  single hex colour so every account gets a polished two-stop gradient without
  needing a second stored value.

Affected files: `frontend/src/theme/swatches.ts` (new helper + presets, removed
hardcoded swatch map), `frontend/src/components/AccountTile.tsx` (use
`account.color` via `colorToGradient` instead of `getSwatch`),
`frontend/src/screens/Overview.tsx` (donut slices use `account.color` directly),
`frontend/src/components/AddAccountModal.tsx` (colour picker UI, passes `color`
to `createAccount`), `frontend/src/components/AddModal.module.css` (colour
picker styles), `src/constants.py` (`VERSION` bumped to `1.3.1`).

---

## [1.3.0] — 2026-05-27

### Added

- **Edit transaction modal.** Clicking a transaction row opens a modal (same style as the Add modal) pre-filled with the transaction's current values. Users can update the merchant, amount, account, or category and save the changes. A Delete button is also available in the edit modal. Transaction rows now show a hover highlight to indicate they are clickable.
- **Balance adjustment on transaction update.** The PUT endpoint now adjusts linked account balances when a transaction's amount or account is changed — previously only create and delete triggered balance adjustments. Reversing the old amount and applying the new amount ensures balances stay accurate after edits.

Affected files: `frontend/src/components/AddModal.tsx` (edit mode, delete support), `frontend/src/components/AddModal.module.css` (delete button, spacer), `frontend/src/components/TxnRow.tsx` (onClick prop), `frontend/src/components/TxnRow.module.css` (clickable hover style), `frontend/src/screens/Transactions.tsx` (editingTxn state), `src/app.py` (balance adjustment in PUT handler), `src/constants.py` (VERSION bumped to 1.3.0).

---

## [1.2.3] — 2026-05-27

### Added

- **Transactions adjust account balances.** Creating a transaction now automatically updates the linked account's balance — a £1,000 income increases the balance by £1,000, a −£50 expense decreases it by £50. Deleting a transaction reverses the adjustment. Works from a zero starting balance (accounts with no prior balance history start at 0). Four new tests cover: expense decreases balance, income increases balance, delete reverses the change, and transaction on a zero-balance account.

Affected files: `src/app.py` (`_adjust_account_balance` helper, updated `create_transaction` and `delete_transaction`), `tests/test_transactions.py` (4 new tests), `src/constants.py` (`VERSION` bumped to `1.2.3`).

---

## [1.2.2] — 2026-05-27

### Fixed

- **Negative transactions now shown in red.** Expense amounts (negative) were displayed in the default text colour, making them hard to distinguish from income. Now uses `--pl-down` (red) for negative and `--pl-up` (green) for positive amounts across all transaction rows.

### Added

- **Account selector in Add Transaction modal.** Transactions can now be linked to a specific account via a dropdown when creating them. Previously the modal silently used the first account with no user choice.

Affected files: `frontend/src/components/TxnRow.tsx` (down class), `frontend/src/components/TxnRow.module.css` (.down style), `frontend/src/components/AddModal.tsx` (account select), `frontend/src/components/AddModal.module.css` (.select style), `src/constants.py` (`VERSION` bumped to `1.2.2`).

---

## [1.2.1] — 2026-05-27

### Added

- **Global "+ Add" dropdown menu.** The header's "+ Add" button (desktop and mobile) now opens a dropdown with three options: Account, Transaction, and Goal. Each option opens its respective creation modal. The menu closes on outside click.

- **Add Account modal.** New modal for creating accounts with a name field and account type chips (Current, Savings, Credit, Investment, Loan). Invalidates accounts and summary caches on save.

- **`createAccount` API function** added to the client.

Affected files: `frontend/src/components/AddMenu.tsx` (new), `frontend/src/components/AddMenu.module.css` (new), `frontend/src/components/AddAccountModal.tsx` (new), `frontend/src/components/Header.tsx` (dropdown wiring), `frontend/src/components/Header.module.css` (addWrap positioning), `frontend/src/components/Shell.tsx` (modal state management), `frontend/src/api/client.ts` (createAccount), `src/constants.py` (`VERSION` bumped to `1.2.1`).

---

## [1.2.0] — 2026-05-27

### Added

- **Settings screen.** Replaces the stub with four sections: **Appearance** (theme mode toggle + accent colour picker with the 5 approved swatches), **Change password** (current + new password fields with validation and error/success feedback), **Session** (sign out button that clears the cookie and redirects to login), and **Danger zone** (delete account with password confirmation, red-bordered card). All actions use the existing backend API endpoints.

- **API client functions** for `logout`, `changePassword`, `deleteAccount`, and `updatePrefs`.

Affected files: `frontend/src/screens/Settings.tsx` (replaced stub), `frontend/src/screens/Settings.module.css` (new), `frontend/src/api/client.ts` (new functions), `src/constants.py` (`VERSION` bumped to `1.2.0`).

---

## [1.1.0] — 2026-05-27

### Added

- **Add Goal modal.** The Goals screen now has a "+ Add goal" button that opens a modal for creating new goals. Fields: name, target amount, already saved (optional), monthly contribution (optional), and a colour picker using the five approved accent colours. Saves via `POST /api/goals` with automatic cache invalidation. The Goals screen also gained a page header with the title and add button.

Affected files: `frontend/src/components/AddGoalModal.tsx` (new), `frontend/src/screens/Goals.tsx` (add button + modal), `frontend/src/screens/Goals.module.css` (header styles), `src/constants.py` (`VERSION` bumped to `1.1.0`).

---

## [1.0.0] — 2026-05-27

### Changed

- **React frontend is now the primary UI.** The old vanilla JS dashboard (`index.html`, `app.js`, `style.css`, `theme-bootstrap.js`, vendored Chart.js and Inter font) has been retired. FastAPI now serves the React SPA directly from `dist/index.html` with no fallback. The login page (`login.html`) and guide page (`guide.html`) remain as standalone HTML pages with self-contained CSS.

- **Dockerfile includes React build stage.** Multi-stage Docker build: Stage 1 (`node:20-slim`) runs `npm ci && npm run build` to produce the frontend bundle; Stage 2 (`python:3.12-slim`) copies the built `dist/` into the runtime image. Docker deployments now serve the React app out of the box.

### Added

- **Accessibility improvements.** Visually-hidden chart summary for screen readers on the Overview net-worth chart. `role="radiogroup"` on Transactions category chips. `sr-only` CSS utility class. Existing `aria-label` attributes on all icon-only buttons (theme toggle, mobile add) retained.

- **Self-contained login and guide pages.** Login page now uses its own `login.css` with embedded CSS variables and theme support, independent of the retired `style.css`. Guide page's `guide.css` similarly made self-contained with embedded token definitions for light/dark modes.

### Removed

- Old vanilla JS dashboard files: `src/static/index.html`, `src/static/app.js`, `src/static/style.css`, `src/static/theme-bootstrap.js`, `src/static/vendor/chart.umd.min.js`, `src/static/vendor/inter/`.
- Six e2e tests that targeted old-UI-only selectors (`test_account_filters`, `test_account_flows`, `test_balance_validation`, `test_icons_render`, `test_password_change`, `test_theme_persistence`). The auth flow e2e test has been updated for the React UI. New React-specific e2e tests should be added iteratively.

Affected files: `Dockerfile`, `src/app.py`, `src/static/` (removed old files, added `login.css`), `src/static/guide.css`, `src/static/guide.html`, `src/static/login.html`, `frontend/src/index.css`, `frontend/src/screens/Overview.tsx`, `frontend/src/screens/Transactions.tsx`, `tests/e2e/`, `tests/test_static_assets.py`, `tests/test_security_headers.py`, `src/constants.py` (`VERSION` bumped to `1.0.0`).

---

## [0.39.0] — 2026-05-27

### Added

- **Goals screen.** Two-column grid of goal cards (single column on mobile), each showing: goal name with ETA microline, colour-tinted percent badge (52×52), saved/target amounts above an HBar progress bar, and an inset contribution editor with a range slider (0–800, step 10) that live-recomputes the ETA on every change. Slider changes are debounced (400ms) and persisted to the API via `PUT /api/goals/{id}` with automatic cache invalidation.

Affected files: `frontend/src/screens/Goals.tsx` (replaced stub), `frontend/src/screens/Goals.module.css` (new), `src/constants.py` (`VERSION` bumped to `0.39.0`).

---

## [0.38.0] — 2026-05-27

### Added

- **Transactions screen.** Full transaction browser with four sections: a stat strip (Showing count, Inflow, Outflow, Net), a filter bar (search pill, account dropdown, date/amount sort toggle, "+ Add" button), category chips for filtering, and a dense transaction list with TxnRow dividers. Search and account/sort filters are server-side via query params; category filter is client-side. The "+ Add" button opens the AddModal for creating new transactions with automatic list refresh.

Affected files: `frontend/src/screens/Transactions.tsx` (replaced stub), `frontend/src/screens/Transactions.module.css` (new), `src/constants.py` (`VERSION` bumped to `0.38.0`).

---

## [0.37.0] — 2026-05-27

### Added

- **Accounts screen.** Replaces the stub with a two-section page: a hero card showing the CardStack of positive-balance accounts with variant picker and a "N LINKED ACCOUNTS" / "Everything you hold" heading, plus a debts section showing negative-balance accounts in a responsive grid of full-size AccountTiles with the total in `theme.down` colour.

Affected files: `frontend/src/screens/Accounts.tsx` (replaced stub), `frontend/src/screens/Accounts.module.css` (new), `src/constants.py` (`VERSION` bumped to `0.37.0`).

---

## [0.36.0] — 2026-05-27

### Added

- **Overview screen.** The default landing page, replacing the stub heading with a full dashboard composed of six sections in a two-column layout (1fr 380px desktop, single column mobile):
  1. **Net-worth hero card** — big formatted value, range pills (7D/30D/90D/1Y), Recharts area chart with hover scrubbing that swaps the displayed value, accent gradient fill, delta pill.
  2. **Stat row** — three cards showing Assets (up colour), Debts (down colour), and Savings rate (accent colour).
  3. **Card stack** — "Your accounts" section with variant picker (fan/cascade/wave/grid) rendering positive-balance accounts as AccountTiles with animated transitions.
  4. **Recent activity** — 6 most recent transactions as TxnRow components with an "+ Add transaction" pill.
  5. **Distribution donut** — SVG donut of account balances with hover-synced centre label and 5-row legend.
  6. **Goals progress** — one row per goal with name, percent, HBar, and "£saved of £target · Nmo left" footer.

Affected files: `frontend/src/screens/Overview.tsx` (replaced stub), `frontend/src/screens/Overview.module.css` (new), `src/constants.py` (`VERSION` bumped to `0.36.0`).

---

## [0.35.0] — 2026-05-27

### Added

- **AccountTile component.** Faux credit-card tile with gradient background from the swatch map, decorative SVG circles, institution label, masked card number (JetBrains Mono), account name, and balance. `compact` prop hides the card-number row and shrinks the balance font.

- **CardStack component.** Renders up to 6 AccountTiles in four layout variants (fan, cascade, wave, grid) with animated transitions via `transform 380ms cubic-bezier(.2,.7,.2,1)`. Hover interactions per variant with z-index elevation. Includes a `VariantPicker` segmented control.

- **LineChart component.** Recharts v3 AreaChart with accent-coloured stroke, gradient area fill (22%/32% opacity for light/dark), right-edge Y-axis tick labels, dashed hover crosshair, active dot, and `onHover` callback for the parent to display scrubbed values.

- **Donut component.** SVG donut with configurable size, thickness, and slice gap. Hover fades non-hovered slices to 0.25 opacity. Center slot for label/value content. `hoverIdx`/`onHover` props for legend sync.

- **Sparkline component.** Tiny inline SVG chart with smooth Bezier interpolation and optional semi-transparent fill. Used on stat cards.

- **HBar component.** Horizontal progress bar with 400ms cubic-bezier width transition. Configurable color, track, and height.

- **TxnRow component.** Transaction row with avatar (merchant initials), merchant name, category/date sub-line, account name (desktop only), and amount with proper sign glyph. Responsive grid columns (4-col desktop, 3-col mobile).

- **AddModal component.** Centered modal (max-width 440px) with backdrop blur, merchant + amount inputs, category chip picker, Save/Cancel footer. Wired to `createTransaction` API via TanStack Query mutation with automatic cache invalidation.

- **RangePills component.** `7D / 30D / 90D / 1Y` segmented control with `role="radiogroup"` accessibility.

- **StatCard component.** Uppercase label, big value, optional sparkline. Configurable colour.

Affected files: `frontend/src/components/` (10 new components + CSS modules), `frontend/src/components/charts/` (4 new chart components), `src/constants.py` (`VERSION` bumped to `0.35.0`).

---

## [0.34.0] — 2026-05-27

### Added

- **Typed API client.** Fetch wrappers for every backend endpoint: accounts, transactions (with filter/sort/pagination params), goals, summary, net-worth series, user, and preferences. All return typed responses matching the backend Pydantic schemas.

- **TanStack Query hooks.** `useAccounts()`, `useTransactions(filters)`, `useGoals()`, `useSummary()`, `useNetWorthSeries(range)` — each returns `{ data, isLoading, error }` with 30s stale time and refetch-on-window-focus. `QueryClientProvider` wired into the app root.

- **Currency formatters.** `fmt(value, currency)` → `"£1,234.56"` and `fmtShort(value, currency)` → `"£1.2k"` with proper minus glyph (U+2212), per-currency symbols, and JPY zero-decimal handling.

- **TypeScript interfaces.** `Account`, `Transaction`, `TransactionFilters`, `Goal`, `Summary`, `NetWorthPoint`, `User`, `Prefs`, `RangeKey`, `AccountType` matching the backend API contract.

Affected files: `frontend/src/types.ts` (new), `frontend/src/api/client.ts` (new), `frontend/src/hooks/` (5 new hooks), `frontend/src/lib/currency.ts` (new), `frontend/src/main.tsx` (QueryClientProvider), `src/constants.py` (`VERSION` bumped to `0.34.0`).

---

## [0.33.0] — 2026-05-27

### Added

- **Layout shell and navigation.** App now renders inside a `Shell` component with a sidebar, header, and responsive breakpoints. Three layout modes driven by viewport width: full sidebar (≥1080px, 220px wide), compact icon-only rail (720–1079px, 64px), and mobile (< 720px, horizontal tab strip replacing the sidebar). Sidebar contains brand mark, four nav items (Overview, Accounts, Transactions, Goals), spacer, Settings, and a signed-in card. Header shows date + greeting on desktop with search pill, theme toggle, and "+ Add" button; mobile header shows brand + toggle + add.

- **NavItem component.** Active state uses `theme.surface` background with `theme.accent` icon tint. Compact mode center-aligns icons and exposes labels via `title` tooltip.

- **Inline SVG icon set.** Nine stroke icons at 16×16, 1.4px stroke width: Grid, Wallet, List, Flag, Settings, Plus, Sun, Moon, Search.

- **Theme toggle wired up.** Sun/moon button in the header fires `toggleMode()` from the ThemeProvider, switching light/dark with the 220ms transition.

Affected files: `frontend/src/components/` (new: `Shell.tsx`, `Sidebar.tsx`, `Header.tsx`, `NavItem.tsx`, `TabStrip.tsx`, plus CSS modules and `icons/`), `frontend/src/App.tsx` (wraps routes in Shell layout), `src/constants.py` (`VERSION` bumped to `0.33.0`).

---

## [0.32.0] — 2026-05-27

### Added

- **Design token system and theme provider.** React context (`ThemeProvider`) that derives a full theme object from a `mode` (light/dark) and `accent` colour. Sets 13 CSS custom properties (`--pl-bg`, `--pl-surface`, `--pl-text`, `--pl-accent`, etc.) on `:root` so all components style against variables, never raw hex values. Light and dark token maps match the design handoff exactly. Includes `accentSoft` derivation via `color-mix(in oklab, ...)`.

- **Per-account swatch map.** Lookup from account ID to gradient pair for the 12 accounts specified in the design handoff, with a `#444 → #777` fallback for unmapped accounts.

- **Theme persistence.** Mode saved to `localStorage` and initialised from `prefers-color-scheme` on first load. Accent colour saved to `localStorage`. Both survive page reloads.

- **Theme transition.** `background 220ms, color 220ms` on the root element when toggling between light and dark modes.

Affected files: `frontend/src/theme/` (new: `tokens.ts`, `ThemeContext.ts`, `ThemeProvider.tsx`, `useTheme.ts`, `swatches.ts`), `frontend/src/main.tsx` (wraps app in `ThemeProvider`), `frontend/src/index.css` (CSS variable usage, transition), `src/constants.py` (`VERSION` bumped to `0.32.0`).

---

## [0.31.0] — 2026-05-27

### Added

- **React scaffold and build pipeline.** Initialised a Vite + React 19 + TypeScript frontend under `frontend/` with client-side routing (React Router), TanStack Query, and Recharts as dependencies for later phases. Five stub screens (Overview, Accounts, Transactions, Goals, Settings) are routed and rendered. Vite builds to `src/static/dist/` so FastAPI serves the SPA without a new static mount.

- **Self-hosted fonts.** Plus Jakarta Sans (variable, 400–800) and JetBrains Mono (variable, 400–600) served as woff2 from `src/static/fonts/`, matching the existing self-hosted pattern (Inter). `@font-face` declarations in the React app's global CSS reference these via absolute `/static/fonts/` paths.

- **SPA route handling.** FastAPI now serves the React `dist/index.html` for `/overview`, `/accounts`, `/transactions`, `/goals`, and `/settings` (authenticated users only). Falls back gracefully to the old vanilla JS `index.html` if no React build is present.

- **CI frontend job.** GitHub Actions workflow now includes a `frontend` job that runs `npm ci`, ESLint, and `vite build` on every push/PR.

Affected files: `frontend/` (new directory), `src/app.py` (SPA routes), `src/static/fonts/` (new font files), `.github/workflows/ci.yml` (frontend job), `.gitignore` (node_modules, dist), `src/constants.py` (`VERSION` bumped to `0.31.0`).

---

## [0.30.0] — 2026-05-27

### Added

- **Transaction CRUD endpoints.** `GET /api/transactions` (with search, account filter, category filter, sort, pagination), `POST /api/transactions`, `PUT /api/transactions/{tid}`, `DELETE /api/transactions/{tid}`. Transactions link to accounts via `account_id` with ownership enforcement. Money stored as integer cents, exposed as float dollars. `occurred_at` defaults to UTC now when omitted. Search filters by merchant or category (case-insensitive LIKE), sort by date (default) or absolute amount, paginate with `page`/`per_page` (max 200).

- **Goal CRUD endpoints.** `GET /api/goals`, `POST /api/goals`, `PUT /api/goals/{gid}`, `DELETE /api/goals/{gid}`. Goals track savings targets with `target`, `saved`, `monthly` fields (all cents-backed). The `PUT` endpoint supports partial updates including monthly contribution slider changes for the frontend.

- **Net-worth time-series endpoint.** `GET /api/history/networth?range=7D|30D|90D|1Y` returns `{date, value}[]` derived from `balance_history`. Aggregates all account balances by date, subtracts liabilities (loan/credit types), converts multi-currency portfolios to the user's base currency via stored exchange rates. Carries forward pre-window balances so the chart is populated even when entries are sparse.

- **Expanded `AccountType` enum.** Added `credit` and `invest` types with dedicated subtype sets (`credit_card`, `store_card`, `charge_card` for credit; `trading_account`, `crypto` for invest). Existing accounts with type `loan` and subtype `credit_card` are migrated to the `credit` type automatically.

- **Enhanced summary endpoint.** `GET /api/summary` now returns `total_credit`, `total_invest`, `assets`, `debts`, and `savings_rate` fields alongside the existing totals.

- **Schema version 2 migration.** New `transactions` and `goals` tables, widened `accounts` CHECK constraint for new types, automatic `credit_card` migration from `loan` to `credit`.

Affected files: `src/app.py`, `src/schemas.py`, `src/db.py`, `src/constants.py`, `tests/test_transactions.py` (new), `tests/test_goals.py` (new), `tests/test_dashboard.py`, `tests/test_delete_me.py`, `tests/test_subtypes.py`.

---

## [0.29.1] — 2026-05-26

### Fixed

- **Charts resize when the browser window is resized.** Chart containers (`.chart-wrap`) lacked an explicit width and `overflow: hidden`, so Chart.js's resize observer did not fire reliably when the CSS grid columns reflowed. Added `width: 100%; overflow: hidden` to the container and a debounced `window.resize` handler that calls `.resize()` on all active charts as a fallback for edge cases like grid breakpoint transitions.

Affected files: `src/static/style.css` (`.chart-wrap`), `src/static/app.js` (resize handler), `src/constants.py` (`VERSION` bumped to `0.29.1`).

---

## [0.29.0] — 2026-05-26

### Changed

- **All charts and account cards use the active theme colour palette.** Charts (balance history, distribution, savings projections, budget) now derive their colours from the user's chosen theme accent rather than per-account stored colours. A `themePalette(n)` generator creates `n` distinct colours by rotating hue from the accent in HSL space, so multi-account charts have distinguishable but harmonious lines/slices that all belong to the chosen palette. Account cards, budget cards, and breakdown table dots also use the palette. Switching themes immediately recolours everything on the next render. The Add Account colour picker also defaults to the theme accent.

Affected files: `src/static/app.js` (`themeAccent()`, `themePalette()`, HSL helpers, all chart render functions, `createAccountCard`, `createBudgetAccountCard`, `renderBreakdownTable`), `src/static/index.html` (default colour value), `src/constants.py` (`VERSION` bumped to `0.29.0`).

---

## [0.28.1] — 2026-05-26

### Fixed

- **Stale-CSS breakage after upgrade: dropdown visible inline, layout broken.** After upgrading to v0.28.0, browsers with cached CSS from the previous version rendered the new HTML (with dropdown markup) against the old CSS (without dropdown styles), causing every dropdown menu item and SVG icon to appear inline in the header. Root cause: no `Cache-Control` header was sent on any response, so browsers used heuristic caching and could serve stale CSS/JS without revalidating. Fix: added `Cache-Control: no-cache` to the security-headers middleware so browsers always revalidate with the server (ETags still allow `304 Not Modified`, so bandwidth is not wasted). Additionally, the dropdown `<div>` now carries the HTML `hidden` attribute as defence-in-depth — even if CSS fails to load entirely, the dropdown content stays invisible until JS explicitly reveals it.

- **Docker: documentation files missing from image.** The Dockerfile only copied `src/` into the image but the `/guide` documentation viewer reads markdown files from `docs/`. Added `COPY docs ./docs` so the guide page works in containerised deployments.

Affected files: `src/security.py` (`Cache-Control: no-cache`), `src/static/index.html` (`hidden` on dropdown), `src/static/app.js` (toggle `hidden`), `src/static/style.css` (`!important` for label swap), `tests/test_security_headers.py`, `Dockerfile` (`COPY docs`), `src/constants.py` (`VERSION` bumped to `0.28.1`).

---

## [0.28.0] — 2026-05-26

### Added

- **Navigation dropdown menu.** The dashboard header controls (username, sign out, dark mode toggle, settings) are collapsed into a single hamburger menu dropdown. The header is now `[Logo] [Net Worth] [+ Add Account] [Menu]`, keeping primary actions visible while decluttering the toolbar. The dropdown contains: username label, dark/light mode toggle, Documentation link, Settings, and Sign out. Closes on click-outside, Escape, or navigation. Motivation: the header had five separate controls competing for space, especially tight on mobile.

- **Public documentation viewer at `/guide`.** The 10 existing markdown docs in `docs/` are now browsable through an in-app documentation page with a sidebar and rendered prose. Accessible without signing in (linked from the login page) and from the logged-in dropdown menu. Uses vendored `marked.min.js` (~40KB) for client-side markdown rendering, matching the Chart.js vendoring pattern. A new `GET /api/docs/{slug}` endpoint serves raw markdown with an allowlist guard against path traversal. The guide page detects auth state and shows "Back to app" for logged-in users or "Sign in" for anonymous visitors. Responsive: sidebar collapses to a slide-in panel on mobile.

Affected files: `src/static/index.html`, `src/static/style.css`, `src/static/app.js` (header dropdown), `src/static/guide.html`, `src/static/guide.css`, `src/static/guide.js` (documentation viewer), `src/static/vendor/marked.min.js` (vendored), `src/static/login.html` (docs link), `src/app.py` (`GET /guide`, `GET /api/docs/{slug}`), `src/constants.py` (`DOCS_DIR`, `DOC_SLUGS`, `VERSION` bumped to `0.28.0`), `tests/test_docs_gating.py` (+6 cases), `tests/test_static_assets.py` (+4 cases).

---

## [0.27.1] — 2026-05-26

### Removed

- **`requirements-dev.txt` deleted.** All dev dependencies (pytest, httpx, pytest-playwright, ruff, mypy, pip-audit, pytest-cov) are declared in `pyproject.toml`'s `[dependency-groups] dev` section and installed via `uv sync`. The separate `requirements-dev.txt` was redundant and incomplete (missing mypy, pip-audit, pytest-cov that were added in v0.23–0.26). Docs updated to point pip users at `uv sync` for dev deps or manual install.

Affected files: deleted `requirements-dev.txt`, updated `docs/getting-started.md`, `docs/deployment.md`, `docs/architecture.md`, `src/constants.py` (`VERSION` bumped to `0.27.1`).

---

## [0.27.0] — 2026-05-26

### Changed

- **Frontend: DOM-element factory functions replace innerHTML rendering.** Five render targets — account cards, projection stat cards, budget item cards, theme swatches, and FX rate rows — are now built via factory functions (`createAccountCard`, `createProjectionStatCard`, `createBudgetAccountCard`, `createBudgetItemRow`, `createThemeSwatch`, `createRateRow`) that return real DOM elements. Containers use `replaceChildren()` instead of `innerHTML =`, which avoids destroying and recreating every child on re-render and removes the need for manual `esc()` calls on user-controlled strings (text is set via `textContent`, which is safe by default). A small `el(tag, attrs, ...children)` helper keeps the factory functions concise. The breakdown table (`renderBreakdownTable`) stays as innerHTML because the `<thead>`/`<tbody>`/`<tr>` nesting would be excessively verbose as factory calls for no security benefit.

- **Frontend: JSDoc type annotations mirror Pydantic response models.** Sixteen `@typedef` declarations at the top of `app.js` now document every API response shape (`AccountOut`, `SummaryOut`, `BudgetItemOut`, `PrefsOut`, `RatesOut`, `HistoryAccountOut`, `SavingsProjection`, `BudgetProjectionAccount`, `BudgetProjectionResult`, etc.). Render and load functions carry `@param` annotations so VSCode and other LSPs can type-check against the API contract. No runtime effect.

- **Frontend: hash-based router for deep-linkable views.** The Overview and Budget Planner views are now driven by `#overview` and `#budget` URL hashes. `showView()` sets the hash, a `hashchange` listener calls `_applyView()`, and the boot sequence reads `currentView()` so a `/#budget` bookmark or shared link lands directly on the Budget Planner. The nav tabs continue to work via the existing `data-action="showView"` delegation. Future views (e.g. Transactions) only need a new entry in the `VIEWS` array and a corresponding `#view-id` section in `index.html`.

Affected files: `src/static/app.js` (all four improvements), `src/constants.py` (`VERSION` bumped to `0.27.0`). After: `uv run pytest` → **294 passed**; `uv run pytest tests/e2e` → **38 passed**; `uv run ruff check .` → clean; `uv run ruff format --check .` → clean; `uv run mypy` → clean.

---

## [0.26.1] — 2026-05-26

### Tests

- **FREQ_TO_MONTHLY multiplier coverage (audit P1 #2).** All four frequency multipliers — weekly (`52/12`), monthly (`1.0`), quarterly (`1/3`), annually (`1/12`) — are now exercised through `/api/budget/projection`. Prior to this, only `"monthly"` was ever passed, so a typo in any non-monthly multiplier would have shipped undetected. New tests verify each frequency individually, plus a mixed-frequency accumulation test that creates weekly + annually items on one account and asserts the summed monthly net. 5 new cases.

- **Budget projection months validation (audit P1 #3).** The in-route allow-list (`months not in (3, 6, 12)` → 400) is now covered. A parametrised test hits every value 1–11 that's outside the allowed set and asserts 400; a companion test confirms 3, 6, and 12 all return 200. Auth gate also pinned. 3 new cases. The previously-uncovered line at `app.py:972` is now hit.

Affected files: `tests/test_budget.py` (+8 cases, now 30), `src/constants.py` (`VERSION` bumped to `0.26.1`). After: `uv run pytest --cov=src` → **294 passed**, 99% coverage (9 missed lines, down from 10); `uv run pytest tests/e2e` → **38 passed**.

---

## [0.26.0] — 2026-05-26

### Added

- **`ruff format --check` in CI (P1-4).** A new formatting check step runs after `ruff check` in the lint job. A one-time `ruff format .` pass was applied across all 34 Python files (pure whitespace/quoting changes, no logic) so the check passes from the first run. Any future PR that introduces unformatted code will fail CI.

- **mypy strict type checking in CI (P1-5).** A new `typecheck` CI job runs `mypy` in strict mode against `schemas.py`, `auth.py`, `db.py`, and `constants.py` — all four pass clean today. `app.py` and `security.py` are excluded for now (21 errors, mostly `sqlite3.Row` → schema-model type narrowing); they'll be widened as type coverage improves. `mypy>=1.11` added as a dev dependency.

- **Coverage reporting in CI (P1-6).** The test job now runs `pytest --cov=src --cov-report=term-missing` and pipes a `coverage report` summary into the GitHub Actions step summary so every PR shows a coverage table. No minimum gate — the current baseline is 99% (702 statements, 10 missed). `pytest-cov>=5.0` added as a dev dependency.

Affected files: `.github/workflows/ci.yml` (three new steps: ruff format check, mypy job, coverage reporting), `pyproject.toml` (new `mypy` + `pytest-cov` dev deps, `[tool.mypy]` config), `uv.lock` (updated), `requirements.txt` (regenerated), `src/constants.py` (`VERSION` bumped to `0.26.0`), plus 34 Python files reformatted by `ruff format`. After: `uv run pytest --cov=src` → **286 passed**, 99% coverage; `uv run pytest tests/e2e` → **38 passed**; `uv run ruff check .` → clean; `uv run ruff format --check .` → clean; `uv run mypy` → clean (4 files).

---

## [0.25.0] — 2026-05-26

### Added

- **Explicit `schema_version` stamp in a `meta` table (P1-1).** `db.init()` no longer relies solely on `PRAGMA table_info` sniffing to decide which migrations to run. A new `meta(key, value)` table is created alongside the other tables, and a `schema_version` row tracks the current schema version as an integer. On first run against a legacy database (pre-v0.25, no `meta` table), `init()` runs all existing sniff-based migrations — which are idempotent — then stamps `schema_version = 1`. On a fresh database the sniff-based migrations are all no-ops and the stamp lands immediately. Subsequent runs read the stamp and skip the legacy path entirely; future migrations gate on `if version < N` instead of column-presence checks, which is both cheaper (no PRAGMA per migration) and less fragile (a table-rewrite that preserves column names won't accidentally re-trigger an earlier migration). `SCHEMA_VERSION` is exported from `db.py` as the single source of truth. The `meta` table is added to the `EXEMPT` set in `tests/test_export.py`'s schema-drift guard since it's infrastructure, not user-scoped data. New tests in `tests/test_migrations.py` (4 cases): legacy DB gets stamped after migration, fresh DB gets stamped on first init, second init skips legacy migrations, and `meta` table exists on a fresh DB.

Affected files: `src/db.py` (new `meta` table, `SCHEMA_VERSION` constant, `_get_schema_version` / `_set_schema_version` / `_run_legacy_migrations` helpers, restructured `init()`), `tests/test_migrations.py` (+4 cases), `tests/test_export.py` (`meta` added to `EXEMPT`), `src/constants.py` (`VERSION` bumped to `0.25.0`). After: `uv run pytest` → **286 passed** (was 282, +4); `uv run pytest tests/e2e` → **38 passed**; `uv run ruff check .` → clean.

---

## [0.24.0] — 2026-05-26

### Added

- **Backup guide (P0-11).** New `docs/backups.md` covering the SQLite `.backup` recipe for both Docker and bare-metal deployments, an automated daily cron job with 7-day rotation, a full restore procedure (stop → copy → start → verify), and a pointer to `GET /api/export` for per-user data portability. Explains why a plain `cp` of a live SQLite database can produce a corrupt copy and why `.backup` is the only safe approach under concurrent writes.

### Changed

- **README simplified; detailed docs moved to `docs/`.** The 921-line README has been replaced with a concise project introduction featuring CI/license/Python badges, a feature list, quick-start snippet, stack summary, and a documentation index linking to the new `docs/` folder. All detailed content — getting started guides, architecture, API reference, database schema, authentication, frontend, deployment (including the Caddy/nginx reverse-proxy snippets), testing, and security notes — now lives in dedicated files under `docs/`. No content was removed; it was reorganised for discoverability.

Affected files: `README.md` (rewritten), new `docs/getting-started.md`, new `docs/architecture.md`, new `docs/api-reference.md`, new `docs/database.md`, new `docs/authentication.md`, new `docs/frontend.md`, new `docs/deployment.md`, new `docs/backups.md`, new `docs/testing.md`, new `docs/security.md`, `src/constants.py` (`VERSION` bumped to `0.24.0`).

---

## [0.23.0] — 2026-05-26

### Added

- **Dependency pinning with `uv lock` (P0-8).** Reproducible installs via a new `pyproject.toml` and `uv.lock` at the repo root. Runtime dependencies (`fastapi>=0.104.0,<0.136.3`, `uvicorn[standard]>=0.24.0`, `slowapi>=0.1.9`) and dev dependencies (`pytest>=9.0`, `httpx>=0.25`, `pytest-playwright>=0.5`, `ruff>=0.6`, `pip-audit>=2.7`) are declared in `pyproject.toml` using PEP 735 dependency groups. The existing `requirements.txt` is now a generated artefact produced by `uv export --no-hashes --no-dev` and kept around for pip users and the Dockerfile's `pip install -r requirements.txt` layer. FastAPI is capped below 0.136.3 because that release was flagged by pip-audit (MAL-2026-4750) for including an undocumented `fastar` dependency in its `[standard]` extra — PiLedger doesn't use the `[standard]` extra so the suspicious package was never pulled in, but pinning below the flagged release keeps the audit clean. CI now uses `astral-sh/setup-uv@v6` and installs with `uv sync --frozen`. A new `lockfile-check` CI job diffs a fresh `uv export --no-hashes --no-dev` against the committed `requirements.txt` so the two never drift.

- **`pip-audit` in CI (P0-9).** A new `audit` CI job runs `uv run pip-audit --strict` after installing dependencies, so any known CVE in the dependency tree fails the pipeline. `pip-audit` is declared as a dev dependency in `pyproject.toml` so it ships in the lockfile.

Affected files: new `pyproject.toml`, new `uv.lock`, regenerated `requirements.txt` (now fully pinned with transitive deps), `.github/workflows/ci.yml` (rewritten to use `uv`; four jobs: lint, test, lockfile-check, audit), `src/constants.py` (`VERSION` bumped to `0.23.0`). After: `uv run pytest` → **282 passed**; `uv run pytest tests/e2e` → **38 passed**; `uv run pip-audit --strict` → no known vulnerabilities; `uv run ruff check .` → clean.

---

## [0.22.1] — 2026-05-25

### Documentation

- **README API reference caught up to v0.22.0.** Several endpoints were live in the running app but undocumented in the README's API reference, which had drifted over a sequence of small PRs that each updated `app.py` + `CHANGELOG.md` without revisiting `README.md`. Newly documented: `DELETE /api/auth/me` (data-lifecycle delete, shipped in v0.20.0) added to the Auth table; new "User preferences" section covering `GET /api/prefs` + `PUT /api/prefs` (shipped in v0.8.0 with the Settings modal); new "Exchange rates" section covering `GET /api/rates` + `PUT /api/rates` (shipped in v0.11.0 with multi-currency, including the "rate against the base currency itself is rejected" + "duplicate currency in payload is rejected" 400 cases); new "Data lifecycle" section covering `GET /api/export` (shipped in v0.20.0 — documents the `version, exported_at, user, accounts, balance_history, budget_items, exchange_rates` shape, the `password_hash` omission, and the `Content-Disposition` attachment filename). Also fixed: the `POST /api/accounts` and `PUT /api/accounts/{id}` body rows were stale — `subtype` (shipped in v0.6.0) and `currency` (shipped in v0.11.0) had never made it into the documented bodies, so anyone copy-pasting from the README would have been hitting account creation without the two columns that actually matter for the budget projection's currency conversion and the dashboard's subtype filtering. New rows note that `subtype` must be valid for the parent `type` (referencing `SUBTYPES_BY_TYPE` in `constants.py`) and that `type` itself is not editable after creation. Affected files: `README.md` only (no source or test changes — the routes were always there). `constants.VERSION` bumped to `0.22.1` so `GET /healthz` reflects the patch.

---

## [0.22.0] — 2026-05-25

### Added

- **`PUT /api/auth/password` + Settings UI (P0-5).** Self-serve password change for the authenticated user, with mandatory session rotation. New `PasswordChangeIn` schema (`current_password` min 1, `new_password` min 8 — mirrors `RegisterIn`'s policy so a change can never weaken a password below the registration floor); the route verifies the current password via `verify_password` (a stolen session cookie alone cannot rotate the credential — defends against XSS-driven privilege escalation), hashes and persists the new one, runs `DELETE FROM sessions WHERE user_id=?` to invalidate **every** prior session for the user (not just the one making the request — if a token has been stolen and is in active use on another device, the password change must kick it out), then calls `make_session(uid)` to mint a fresh token and sets the new cookie on the response. The DELETE-then-INSERT pattern means the new row is unrelated to the old one, so even a leaked old-token cookie can't be repurposed if the row is somehow reanimated. The new cookie written on the same response keeps the *current* browser logged in seamlessly after the rotation — the user never sees a flash of unauth state. Settings modal gains a "Change Password" section (`#settings-password-field`) with three stacked password inputs (`#pw-current`, `#pw-new`, `#pw-confirm`), a primary "Update Password" button, and an inline status line (`#pw-status`) that lights up green on success and red on error. The new section is gated on three client-side preconditions before any network call (all fields filled, new password ≥ 8 characters, new and confirm match, new differs from current) so the API only sees well-formed requests; a fourth check on `current` vs `new` is also client-side because a no-op rotation would still kick the user's other sessions out for nothing. The handler uses raw `fetch` instead of the `apiFetch` wrapper — the wrapper auto-redirects to `/login` on 401, which is exactly the wrong UX when 401 means "you typed your current password wrong" (the user would be silently kicked to login and lose their typed new password). Inline 401 surfaces as "Current password is incorrect." with the `.error` class. New `tests/test_password_change.py` (10 cases) pins: 401 unauthenticated, 401 wrong current, 400 short new password, 400 unknown extra fields (the `_In.extra="forbid"` guarantee), 400 missing fields, 200 happy path with fresh cookie issued and old cookie token differing, full login round-trip (old password → 401, new password → 200) proving the hash is persisted, the pre-change cookie no longer authenticates server-side even when manually re-attached to the client jar (proves the server — not the client — drops it), the "kills other sessions" property exercised with two independent `TestClient` instances logged in as the same user where device-A's password change instantly 401s device-B's still-cached token, and cross-user isolation (bob's password and session both unaffected when alice changes hers). New `tests/e2e/test_password_change.py` (4 cases) drives the full browser flow: form renders, mismatched confirmation shows inline red error, wrong current password shows inline red error and the user stays on the dashboard (not bounced to /login), and the success path covers settings → submit → green status → sign out → sign in with new password (old password rejected at login).

### Changed

- **Modal frame caps at 90vh and the body scrolls internally.** The Settings modal now contains five sections (Appearance, Colour Theme, Base Currency, Exchange Rates, Change Password) and was overflowing the viewport on laptop screens — the "Update Password" button ended up below the fold and clicking it required scrolling the whole page. `.modal` gains `max-height: 90vh` + `display: flex; flex-direction: column`, and `.modal-body` gains `overflow-y: auto; min-height: 0`. Header and footer pin to the modal frame so the close button and primary action are always visible regardless of content length. Affects every modal in the app (Add Account, Update Balance, Edit Account, Confirm Delete, Settings, Add Budget Item, Confirm Delete Budget) — the rule is purely additive (`max-height` only triggers scroll when the body actually exceeds the cap), so the existing four shorter modals render identically.

- **README API reference grew a `/api/auth/password` row.** Under the Auth table, alongside the existing register / login / logout / me rows.

Affected files: `src/schemas.py` (new `PasswordChangeIn`), `src/app.py` (one new route + `PasswordChangeIn` import), `src/static/index.html` (Settings-modal password section), `src/static/app.js` (`submitPasswordChange` + client-side validation + status helper + `openSettingsModal` resets the form on open), `src/static/style.css` (`.pw-actions` / `.pw-status` / `.pw-status.ok` / `.pw-status.error` + the `.modal` / `.modal-body` scroll changes), `README.md` (Auth table row), new `tests/test_password_change.py` (10 cases), new `tests/e2e/test_password_change.py` (4 cases). After: `./venv/bin/pytest` → **282 passed** (was 272, +10); `./venv/bin/pytest tests/e2e` → **38 passed** (was 34, +4); `./venv/bin/ruff check .` → clean.

---

## [0.21.0] — 2026-05-25

### Added

- **`GET /healthz` (P0-2).** Unauthenticated liveness probe returning `{"ok": true, "version": "<VERSION>", "uptime_s": <int>}`, registered with `include_in_schema=False` so it stays out of the OpenAPI doc and doesn't crowd the user-facing API surface. The version string comes from a new `constants.VERSION` constant (single source of truth — bump in lock-step with the CHANGELOG header on every release), and `uptime_s` is computed against a `time.monotonic()` snapshot taken at import time rather than the wall clock, so a system NTP adjustment can't make uptime go backwards. The endpoint is deliberately unauthenticated: every external uptime monitor (Uptime Kuma, Healthchecks.io, kube liveness probes) needs to poll without holding a session, and the response carries nothing sensitive beyond the version string. The Docker `HEALTHCHECK` line and the `docker-compose.yml` healthcheck both pivot off `/login` and onto `/healthz`, and now assert *both* HTTP 200 *and* a truthy `ok` field — a half-broken process whose SQLite has gone wonky might still serve static `/login` HTML, but its `/healthz` call will return an exception-cooked response (or fail to import) and trip the check correctly. New `tests/test_healthz.py` (5 cases) pins the unauthenticated contract, response shape, monotonic uptime (two probes >1s apart and asserts the counter advanced), exclusion from the OpenAPI schema, and that the P0-3 security-headers middleware still wraps the response (HSTS / `X-Frame-Options: DENY` / `X-Content-Type-Options: nosniff` are all present).

- **Gated Swagger UI / ReDoc / OpenAPI JSON (P0-10, path 2).** FastAPI's default `/docs`, `/redoc`, and `/openapi.json` mounts are now disabled at the constructor (`docs_url=None`, `redoc_url=None`, `openapi_url=None`), and replaced by three custom routes that gate on the session cookie. `GET /docs` and `GET /redoc` mirror the behaviour of `GET /` — they 302-redirect to `/login` for unauthenticated browsers (so a self-hoster following a bookmark sees a familiar login page rather than a JSON error blob), then render `get_swagger_ui_html` / `get_redoc_html` once logged in, both pointed at the gated JSON URL. `GET /api/openapi.json` is a JSON API endpoint so it follows the `/api/` convention and 401s without a session, matching the existing surface; logged-in users get back `app.openapi()` which still works as a FastAPI method regardless of whether the default route is mounted. Smoke-tested live: unauth `GET /healthz` → 200 JSON; unauth `GET /docs` → 302 to `/login`; unauth `GET /openapi.json` (the FastAPI default location) → **404** (proof an anonymous scanner can't grab the spec from the well-known path); unauth `GET /api/openapi.json` → 401. New `tests/test_docs_gating.py` (8 cases) pin all four of those behaviours plus that the Swagger UI page actually loads the bundled `swagger-ui` JS and points at our gated JSON URL (so a future regression that swaps in an empty 200 is caught), that ReDoc renders distinctly (not accidentally Swagger UI), and that the returned OpenAPI spec is populated (asserts `info.title == "PiLedger"` and `/api/auth/login` appears in `paths`) and that `/healthz`, `/docs`, and `/api/openapi.json` themselves are excluded from `paths` via `include_in_schema=False`.

- **Reverse-proxy reference configs in the README (P0-6).** New "HTTPS" subsection under "Network Access" replaces the previous one-paragraph "front it with nginx/Caddy" hand-wave with two concrete, copy-paste-ready snippets — a Caddyfile and an `nginx.conf` site — both terminating TLS at the proxy and forwarding to `127.0.0.1:8080`. The block starts with a "Before exposing the app behind a proxy" checklist that pins the three foot-guns: switch Uvicorn from `0.0.0.0` to `127.0.0.1` (otherwise port 8080 stays reachable on the LAN and the TLS gate can be bypassed), set `COOKIE_SECURE=true` (the session cookie must refuse plain HTTP), and decide where rate limiting lives (the app-layer login limit shares one bucket behind a proxy, so both snippets include a proxy-layer per-client `5r/m` rate limit on `/api/auth/login` as belt-and-braces). The nginx snippet explicitly carries `proxy_http_version 1.1;` and `proxy_set_header Connection "";` — without those, nginx defaults to HTTP/1.0 upstream and drops keep-alive, which is the most-cited footgun on every r/selfhosted FastAPI thread. A "verifying the proxy is up" curl at the bottom hits `/healthz` (rather than `/login`) because the JSON return body isolates "proxy + TLS + app" from "credentials work" — `/healthz` returns 200 even before any user has registered.

### Changed

- **README API reference grew an "Ops" table.** The new section documents `/healthz`, `/docs`, `/redoc`, and `/api/openapi.json` with their auth requirements at the top of the API reference, before the existing Auth / Accounts / Balance / Dashboard / Budget tables. Ops endpoints sit there because they're cross-cutting (touched by every uptime monitor, every browsing self-hoster) rather than belonging to any one feature.

Affected files: `src/constants.py` (new `VERSION` constant), `src/app.py` (`time` import, `get_swagger_ui_html` / `get_redoc_html` imports, `VERSION` import, FastAPI constructor disables default docs/openapi mounts, `_BOOT_MONOTONIC` module-level, four new routes: `/healthz`, `/api/openapi.json`, `/docs`, `/redoc`), `Dockerfile` + `docker-compose.yml` (healthcheck switched from `/login` to `/healthz` and asserts both 200 *and* `ok: true`), `README.md` (new "Ops" table in the API reference, expanded "HTTPS" subsection with Caddy + nginx snippets and the proxy-prep checklist), new `tests/test_healthz.py` (5 cases), new `tests/test_docs_gating.py` (8 cases). After: `./venv/bin/pytest` → **272 passed** (was 260, +12); `./venv/bin/pytest tests/e2e` → **34 passed** (unchanged); `./venv/bin/ruff check .` → clean. Live smoke-test confirmed `/healthz` 200, `/docs` 302→/login, `/openapi.json` 404, `/api/openapi.json` 401.

---

## [0.20.0] — 2026-05-25

### Added

- **`GET /api/export` and `DELETE /api/auth/me` (P0-12 + P0-13).** Two complementary data-lifecycle endpoints that close the GDPR/portability story: an authenticated user can now download a complete JSON copy of their own data, and can self-serve delete their account without DB access. The pair is bundled by design — both walk the same `USER_SCOPED_TABLES = ("accounts", "balance_history", "budget_items", "exchange_rates")` constant in `src/db.py`, so a future per-user table cannot ship without extending the export and the delete cascade in lock-step. `tests/test_export.py::test_user_scoped_tables_covers_every_user_keyed_table` enumerates `sqlite_master`, finds every table carrying a `user_id` or `account_id` column, exempts `users` (the user row itself, special-cased in both routes) and `sessions` (auth state, wiped on delete but never exported), and asserts the rest are all named in `USER_SCOPED_TABLES`. A second guard test asserts the reverse — that every name in the constant maps to a real table — so a typo or stale entry would surface as `OperationalError` at test time rather than 500 at request time. `GET /api/export` returns `{"version": 1, "exported_at": <ISO-8601 UTC>, "user": {...}, "<table>": [...rows], ...}` with `Content-Disposition: attachment; filename="piledger-export-<username>-<YYYY-MM-DD>.json"` so browsers save the response rather than render it; the user row is deliberately re-selected to **exclude** `password_hash` (pinned by `test_export_omits_password_hash`) — exporting it would be a credential-exposure footgun, and the export's purpose is data portability rather than identity migration. `balance_history` doesn't carry `user_id` directly, so the helper `db.user_scoped_select_sql("balance_history")` returns a subselect through `accounts` (`WHERE account_id IN (SELECT id FROM accounts WHERE user_id=?)`); the cross-user isolation test seeds both alice and bob and verifies alice's export contains no row whose `balance_cents` matches a bob-only deposit, which would have caught a missing join condition. `DELETE /api/auth/me` takes a `{"password": "..."}` body (new `DeleteMeIn` schema with `extra="forbid"`), re-verifies the password via `verify_password` (defends against XSS-driven CSRF — a stolen session cookie alone cannot trigger a wipe), then explicitly cascades by calling `user_scoped_delete_sql(table)` for every table in `USER_SCOPED_TABLES`, then clears `sessions WHERE user_id=?`, then deletes the `users` row, then sets a clearing `Set-Cookie` on the response. The explicit per-table cascade is intentionally redundant with the schema's `ON DELETE CASCADE` foreign keys (visible in `src/db.py:64-100`) — defence in depth means a future migration that adds a user-scoped table without an `ON DELETE CASCADE` FK still gets wiped, and the cascade is readable in `app.py` rather than buried in the schema. Wrong-password attempts return 401 (`test_delete_me_wrong_password_returns_401`), missing/extra body fields return 400 via the existing `_validation_to_400` handler (`test_delete_me_missing_password_is_400`, `test_delete_me_rejects_unknown_fields`), and the username becomes immediately re-registerable after delete (`test_delete_me_frees_username_for_reuse`). The pre-delete session token is asserted to no longer authenticate even when manually re-attached to the client cookie jar (`test_delete_me_invalidates_old_session_token`), proving the server — not just the client — drops it. Affected files: `src/db.py` (new `USER_SCOPED_TABLES` constant + `user_scoped_select_sql` / `user_scoped_delete_sql` helpers), `src/schemas.py` (new `DeleteMeIn`), `src/app.py` (two new routes + extra imports), new `tests/test_export.py` (9 cases), new `tests/test_delete_me.py` (9 cases). After: `./venv/bin/pytest` → **260 passed** (was 242, +18); `./venv/bin/pytest tests/e2e` → **34 passed** (unchanged); `./venv/bin/ruff check .` → clean.

---

## [0.19.0] — 2026-05-25

### Added

- **Six additional colour themes in the Settings picker.** The palette has gone from four options (Olive, Indigo, Slate, Rose) to ten: Emerald, Teal, Sky, Violet, Crimson, and Amber join the existing set so users can pick something closer to their preferred accent across the green / blue / purple / red / orange / neutral spectrum rather than being forced into one of two warm and two cool choices. Each new theme overrides only `--accent` / `--accent-dk`; `--accent-lt` and `--accent-ring` continue to derive from those via `color-mix`, so every accent-aware element (focus rings, active swatch border, account cards, account-edit modal accent, budget cards, projection cards, dashboard headings, the Sign Out / Add Account buttons) inherits the new tint automatically — no per-theme one-off rules required, and dark mode works for the new palettes without any extra wiring because the `[data-mode="dark"]` block re-derives `--accent-lt` and `--accent-text` from whichever accent is active. Picked hues are the Tailwind-600/700 pairs (emerald `#059669` / `#047857`, teal `#0d9488` / `#0f766e`, sky `#0284c7` / `#0369a1`, amber `#d97706` / `#b45309`, crimson `#dc2626` / `#b91c1c`, violet `#7c3aed` / `#6d28d9`) — those land at roughly the same perceived contrast as the existing accents, so none of the new options blow out the text/border tones on the surface or get washed out in dark mode. The picker grid is `repeat(auto-fill, minmax(120px, 1fr))`, so it absorbs the extra swatches by wrapping onto a second row without any layout change. The frontend `THEMES` array is also re-ordered to walk the spectrum (Olive → Emerald → Teal → Sky → Indigo → Violet → Rose → Crimson → Amber → Slate) so the picker reads as a colour wheel rather than four originals followed by six new ones. Affected files: `src/constants.py` (the `Theme = Literal[...]` allowlist gains the six new ids — adding the backend value is what causes the prefs endpoint to accept them; without this the new swatches would 400 on click), `src/static/style.css` (six new `[data-theme="..."]` blocks), `src/static/app.js` (rebuilt `THEMES` array with the new swatches in spectrum order), `tests/test_prefs.py` (`test_every_allowed_theme_accepted` now iterates the full ten-value list so a future drop of any value from the literal trips a test instead of shipping). After: `./venv/bin/pytest` → **242 passed** (unchanged); `./venv/bin/pytest tests/e2e` → **34 passed** (unchanged).

---

## [0.18.0] — 2026-05-21

### Changed

- **Application source moved into `src/`.** The six Python modules (`app.py`, `auth.py`, `constants.py`, `db.py`, `schemas.py`, `security.py`) and the entire `static/` tree (frontend HTML/CSS/JS plus vendored Chart.js + Inter font) now live under a single `src/` directory at the project root. The repo root was getting cluttered with backend modules sitting next to docs, config, container files, and runtime data — moving the sources behind one `src/` folder makes "what is application code" vs "what is project infrastructure" visually obvious the moment you `ls` the repo. Tests, requirements files, `pytest.ini`, `start.sh`, `Dockerfile`, `docker-compose.yml`, the runtime SQLite file, and the docs all stay at the project root. The SQLite default path was deliberately preserved — `constants.DB` now resolves to `<repo>/piledger.db` (via `os.path.join(os.path.dirname(__file__), os.pardir, "piledger.db")` plus a `normpath` so the displayed path is clean) rather than letting it silently move to `src/piledger.db` and break every dev environment with an existing DB at the old location. `PILEDGER_DB` overrides remain authoritative and unchanged. Static asset references inside `app.py` (`FileResponse("static/login.html")`, `FileResponse("static/index.html")`, `app.mount("/static", StaticFiles(directory="static"))`) used to be CWD-relative, which was fragile — they're now anchored to a module-level `_STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")` so the app boots correctly regardless of where uvicorn is invoked from (start.sh, the Docker entrypoint, an IDE, a systemd unit). Supporting scripts updated accordingly: `start.sh` and `tests/e2e/conftest.py` now pass `--app-dir src` to uvicorn; `pytest.ini` switched `pythonpath = .` → `pythonpath = src` so `import app`, `import constants`, etc. continue to resolve from the test suite; `tests/test_static_assets.py`'s on-disk `STATIC_DIR` constant now points at `tests/.parent.parent / "src" / "static"`; the `Dockerfile` swapped its per-file `COPY app.py auth.py constants.py db.py schemas.py ./` + `COPY static ./static` lines for a single `COPY src ./src` (and the runtime `CMD` gained `--app-dir src`) — a side benefit being that the single `COPY src` also picks up `security.py`, which the previous file-by-file list had been silently missing since P0-3 landed in 0.15.0 (the running container would have failed at import; the bug only didn't bite because `docker compose build` apparently hadn't been re-run since). README's file-tree, prose-level module mentions, "alongside `app.py`" wording for the DB default, and three `uvicorn app:app` snippets (including the systemd `ExecStart` line which got an absolute `--app-dir /home/charlie/git/piledger/src`) were updated. Smoke-tested by booting `./start.sh` from the project root with `PILEDGER_DB=/tmp/...` overriding the default and curl-ing `/login` (200, 2737 bytes), `/static/app.js` (200, 55559 bytes), `/static/vendor/chart.umd.min.js` (200, 205222 bytes) and the `/` → `/login` redirect (302) to confirm both the moved static directory and the CWD-independent path resolution work in the running app. All 242 unit/API tests and 34 e2e tests pass unchanged. Affected files: 6 Python modules + the static/ tree moved into `src/`; modified `src/app.py` (new `os` import, `_STATIC_DIR` constant, three FileResponse/StaticFiles call sites), `src/constants.py` (DB default uses `os.pardir`), `start.sh` (`--app-dir src` + a comment explaining why CWD stays at the project root), `Dockerfile` (single `COPY src ./src`, `CMD` gains `--app-dir src`, comment about the security.py recovery), `pytest.ini` (`pythonpath = src`), `tests/e2e/conftest.py` (subprocess uvicorn invocation + `PYTHONPATH`), `tests/test_static_assets.py` (path constant), `README.md` (file tree, three uvicorn snippets, DB-default wording, backend-module paragraph).

---

## [0.17.2] — 2026-05-21

### Tests

- **Schema migration coverage.** `db.init()` carries nine conditional, additive migrations gated by `PRAGMA table_info` checks (add `accounts.user_id`, widen `accounts.type` CHECK to allow `'loan'` via table-rewrite, add `users.theme` / `users.dark_mode`, add `accounts.subtype`, add `accounts.currency`, add `users.base_currency`, convert `balance_history.balance` REAL → `balance_cents` INTEGER, convert `budget_items.amount` REAL → `amount_cents` INTEGER). Until this release every one of these branches was dead-tested: the suite has always started from a fresh DB so the `CREATE TABLE IF NOT EXISTS` fast path runs and the migration bodies never fire. A future change that mis-orders a CAST, drops a column from the table-rewrite SELECT list, or breaks an additive ALTER would have shipped silently and only manifested when a long-deployed user upgraded — the worst possible time to discover it. New `tests/test_migrations.py` (18 cases) materialises the pre-migration ("v0") schema directly with raw `executescript`, seeds a representative row in every table (one user, two accounts, two balance-history entries with REAL balances, two budget items with REAL amounts including a negative one to pin sign preservation), then calls the real `init()` and asserts: every expected column is present after; the type CHECK now mentions `'loan'` and accepts an inserted loan row; existing accounts survive the table-rewrite with `id` / `name` / `type` / `interest_rate` / `color` preserved; default backfills land correctly (`theme='olive'`, `dark_mode=0`, `subtype='general'`, `currency='GBP'`, `base_currency='GBP'`); the riskiest migrations (the two REAL → INTEGER conversions) round exactly to cents with `1234.56 → 123456`, `8000.00 → 800000`, `3000.00 → 300000`, and crucially `-1234.55 → -123455` (negative values are the loan-payment encoding from `test_loans.py`, so a regression that absolute-valued the cast would break the budget projection in production but not in any other test). Idempotency is pinned — running `init()` a second time on the already-migrated DB must be a no-op rather than re-firing a table-rewrite or duplicating data — and a separate "fresh install" case confirms `CREATE TABLE IF NOT EXISTS` produces every column the routes expect.

Affected files: new `tests/test_migrations.py` (18 cases). After: `./venv/bin/pytest` → **242 passed** (was 224, +18); `./venv/bin/pytest tests/e2e` → **34 passed** (unchanged). No source changes.

---

## [0.17.1] — 2026-05-21

### Tests

- **Budget endpoint coverage gap closed.** Until this release the only direct test of `GET/POST/PUT/DELETE /api/budget*` was a single round-trip inside `tests/test_loans.py:139`, which meant auth, user isolation, validation, cascading delete, and partial-PATCH semantics on the entire budget surface were unguarded — a regression that dropped the `account_id` ownership check at `app.py:643-646` (letting bob create a budget item targeting alice's account) would have shipped without anything tripping. New `tests/test_budget.py` (22 cases) pins: 401 on every budget endpoint when unauthenticated; bob cannot POST against alice's `account_id`, cannot read/edit/delete alice's items; 404 for nonexistent or other-user items on both PUT and DELETE; `ON DELETE CASCADE` from `accounts → budget_items` (`db.py:95`) actually removes the child rows when the parent account is deleted; rejection of blank name / unknown frequency / amount above `MAX_MONEY` / unknown extra fields (the `_In.extra="forbid"` guarantee); explicit acceptance of negative amounts so the loan-payment encoding documented in `test_loans.py` is pinned as a contract; partial PATCH semantics so name-only / amount-only / frequency-only updates leave every other field untouched; and empty-body PATCH as a 200 no-op (the `if patch:` short-circuit at `app.py:672`). All 22 pass first run with no source changes.

- **Session cookie attributes pinned.** `app.py:137-144` sets `httponly`, `samesite="lax"`, a 30-day `Max-Age`, and conditionally `Secure` based on the `COOKIE_SECURE` env var, but the test suite never inspected the actual `Set-Cookie` header — a regression that dropped `HttpOnly` would have silently exposed the session token to client-side JS (defeating the XSS-defence story that CSP-without-unsafe-inline is meant to back up), and one that flipped `samesite` would have weakened CSRF protection. New `tests/test_sessions_and_cookies.py` parses the raw `Set-Cookie` line and asserts `HttpOnly` present, `SameSite=Lax`, `Path=/`, `Max-Age = SESSION_DAYS * 86400`, `Secure` absent by default (so HTTP-only LAN deployments keep working), and `Secure` present when the `COOKIE_SECURE` flag is monkeypatched on. The cookie helper parses the header with a small `_parse_set_cookie` shim rather than relying on `httpx.Cookies` (which discards boolean attributes), so attribute-presence regressions can't slip past.

- **Server-side session expiry covered.** The same new test file exercises the two `auth.py` branches that were previously dead-tested: `session_uid`'s `expires_at > now` filter (now `tests/test_sessions_and_cookies.py` writes a row directly with `expires_at` in the past and confirms `/api/auth/me`, `/api/accounts`, `/api/summary`, and `/api/prefs` all 401 with that token) and `make_session`'s opportunistic eviction sweep (after a fresh login, the previously-expired row is gone from the `sessions` table). Without these, an off-by-one in the `WHERE expires_at>?` comparison or a future change to the sweep query could quietly leave expired tokens valid or fail to clean up the table over time.

- **`BalanceIn.recorded_at` parser branches covered.** The four-branch field validator at `schemas.py:78-94` had only canonical-Z form exercised; the lenient `+00:00`, naive (no-tz), and non-UTC-offset paths — exactly the timezone-bug-prone code — were unguarded. New `tests/test_recorded_at_parser.py` (8 cases) round-trips canonical Z, asserts `+00:00` is re-emitted as `Z`, asserts naive ISO is tagged UTC and re-emitted, asserts `+05:00` converts to UTC-7, asserts `-08:00` converts to UTC+8, rejects garbage strings and empty strings with 400, and pins the missing-field default (server stamps a canonical-format timestamp). The 20-char Z-suffixed shape is asserted on the default-stamping path so a regression that stored `None` or a non-canonical format would be caught.

Affected files: new `tests/test_budget.py` (22 cases), new `tests/test_sessions_and_cookies.py` (9 cases), new `tests/test_recorded_at_parser.py` (8 cases). After: `./venv/bin/pytest` → **224 passed** (was 185, +39); `./venv/bin/pytest tests/e2e` → **34 passed** (unchanged). No source changes.

---

## [0.17.0] — 2026-05-21

### Added

- **Distribution chart can switch between doughnut and horizontal bar.** A small two-button toggle ("Doughnut" / "Bar") now sits in the Distribution card header on the overview. Doughnut remains the default (existing layout, same colours, same native-currency tooltip with an "(≈ base)" suffix on cross-currency accounts). Horizontal bar mode reorders the accounts descending by base-converted balance so the largest sits at the top — much easier to read exact balances and rank accounts at a glance once there are more than four or five, which is the case the doughnut consistently loses to. The user's choice is persisted to `localStorage` under `piledger:distChart` (no backend prefs change, since this is a purely visual preference) and the toggle's active state is synced to the saved value on first render. Toggling re-renders from a cached account list rather than re-fetching `/api/accounts`. Loans are still excluded in both modes (they are liabilities, not part of the asset mix). Affected files: `static/index.html` (toggle markup in the Distribution chart-header), `static/style.css` (`.chart-type-toggle` + `.chart-type-btn` styles, mirroring `.period-btn` so it inherits theme + dark-mode colours), `static/app.js` (`chartPrefs.distributionType`, `distributionAccounts` cache, `renderDistributionDoughnut` / `renderDistributionBar` split, `setDistributionChartType` exposed on `window` for the existing `data-action` delegator).

- **Interactive crosshair tooltips on every line chart.** Hovering anywhere along the Balance History, Savings Projection, or Budget Projection charts now lights up a tooltip showing every account's value at that date in one place, instead of requiring the cursor to land directly on an individual point dot. A thin dashed vertical guide line follows the cursor at the active x-position so the tooltip and the visual selection agree on which date is being read. Implemented as a shared `LINE_OPTS` (sets Chart.js `interaction.mode = 'index'`, `intersect = false`, `axis = 'x'`, plus matching `hover` and `tooltip` modes) merged into the three line charts on top of the existing `BASE_OPTS`, and a tiny `crosshairPlugin` registered with `Chart.register()` that draws the guide line in `afterDatasetsDraw`. The plugin early-exits on non-line charts (`chart.config.type !== 'line'`) so the doughnut and horizontal-bar distribution charts aren't accidentally striped with a vertical line, and on charts with no active tooltip element (empty-state placeholder, mouse outside chart area) so it never draws a stray line in those cases. The Budget chart's existing legend filter that hides the "Zero" reference dataset is preserved by merging `LINE_OPTS.plugins` first, then overlaying the legend customisation, so neither the index-mode tooltip nor the Zero-line hiding gets lost. Tooltip styling gains a darker semi-transparent background, larger padding, and a 6px corner radius — the index-mode tooltip is much denser than the previous single-series one, so it needs the extra breathing room to stay readable. Affected files: `static/app.js` (`crosshairPlugin`, `LINE_OPTS`, three `...LINE_OPTS` spreads in `renderHistoryChart`, `renderProjectionChart`, `renderBudgetChart`).

---

## [0.16.0] — 2026-05-20

### Added

- **Login rate limiting (P0-4).** `POST /api/auth/login` is now capped at **5 attempts per minute per source IP** via [SlowAPI](https://slowapi.readthedocs.io/), addressing the "no rate limiting on login attempts" gap previously documented in README's Security Notes. PBKDF2 at 260 000 iterations puts brute-force ceiling at roughly 10 attempts/sec, which is ~36 000/hour against an 8-character password — fast enough that a determined attacker with network reach could realistically work the bottom of the password-strength distribution. The 5/min cap drops that ceiling by three orders of magnitude (300/hour). The limit is configurable via `PILEDGER_LOGIN_RATE_LIMIT` (slowapi string syntax — `10/minute`, `100/hour`, etc.) so an operator running an internal-only deployment can loosen it without code changes. The key function is the socket peer IP (`slowapi.util.get_remote_address`), not `X-Forwarded-For` parsing — chosen deliberately to avoid the trusted-proxy-allowlist footgun where a misconfigured allowlist lets an attacker spoof the header and evade the cap entirely. The README's existing "front with a reverse proxy" guidance already covers internet-facing deployments where per-client rate limiting must happen at the proxy layer (where the real client IP is visible); the app-layer limit remains a defence-in-depth backstop for LAN deployments. SlowAPI registers a default `RateLimitExceeded` exception handler that returns 429 with a JSON body and standard `Retry-After` / `X-RateLimit-*` headers — and because `SecurityHeadersMiddleware` (P0-3) runs after the handler, every 429 still carries the full defensive header set. Affected files: `requirements.txt` (new `slowapi>=0.1.9` dep), `constants.py` (new `LOGIN_RATE_LIMIT` constant with env override), `app.py` (Limiter wiring, exception handler registration, `request: Request` added to the login signature, `@limiter.limit(LOGIN_RATE_LIMIT)` decorator), `tests/conftest.py` (disables the limiter in the shared `app` fixture so suite-wide login fixtures don't trip the cap), `tests/e2e/conftest.py` (sets `PILEDGER_LOGIN_RATE_LIMIT=10000/minute` for the session-scoped Uvicorn subprocess, since the production cap would otherwise drop the e2e suite from 34 passed to ~26 once the shared 127.0.0.1 bucket runs dry), new `tests/test_rate_limit.py` (6 cases pinning: 5 under-cap logins succeed, 6th attempt returns 429 regardless of password validity, register and `GET /login` stay unaffected, and 429 responses still carry the P0-3 security headers), `README.md` (Security Notes — moves login rate-limiting from "not protected" to "protected", documents the `PILEDGER_LOGIN_RATE_LIMIT` env var and the shared-bucket-behind-proxy caveat, and adds a one-liner summarising the P0-3 header set).

---

## [0.15.0] — 2026-05-20

### Added

- **Security-headers middleware (P0-3).** New `security.py` registers a `SecurityHeadersMiddleware` on the FastAPI app that attaches a fixed set of defensive HTTP response headers to every reply: a one-year `Strict-Transport-Security` with `includeSubDomains`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, a `Permissions-Policy` that disables geolocation/microphone/camera/payment, and a strict `Content-Security-Policy` (`default-src 'self'; script-src 'self'; …`) with **no** `'unsafe-inline'` on `script-src`. The middleware uses `response.headers.setdefault(...)` so individual routes can still override a header for a specific response without it being clobbered on the way out. Without the asset and handler work below the strict CSP would have broken the dashboard at first paint, which is why P1-7 and P1-8 ship in the same change.
- **Vendored Chart.js + Inter (P1-7).** Chart.js 4.4.0 (`static/vendor/chart.umd.min.js`, 200 KB unminified) and the Inter Latin subset (`static/vendor/inter/inter-latin.woff2`, 47 KB, with five `@font-face` declarations in `static/vendor/inter/inter.css` covering weights 300–700) are now served from `/static`. The dashboard no longer reaches out to `cdn.jsdelivr.net` or `fonts.googleapis.com` on first paint, which is what makes `script-src 'self'`/`font-src 'self'` feasible — and as a side effect the SPA now boots fully offline once the page is cached.

### Changed

- **Every inline event handler removed from the SPA (P1-8).** The 44 `onclick=`/`onchange=` attributes in `static/index.html` and the 4 in `static/login.html`, plus the 7 dynamically-rendered `onclick=` strings inside `static/app.js` template literals, are now expressed as `data-action="functionName"` (plus optional `data-arg="..."` for arguments). Two document-level delegated listeners in `app.js` — one for `click`, one for `change` — look up the named function on `window` and invoke it with the parsed argument (string/number/boolean coercion is automatic). Selects that need the new value pass an additional `data-pass-value` attribute. The two `<script>` blocks in `static/login.html` (the pre-paint theme bootstrap and the ~80-line login-form logic) have been extracted to `static/theme-bootstrap.js` and `static/login.js`; `static/index.html` references the same `theme-bootstrap.js`. Net effect: every page served by PiLedger now has **zero** inline `<script>` content and **zero** `on*=` attributes, so a CSP without `'unsafe-inline'` on `script-src` is satisfiable.

### Tests

- New `tests/test_security_headers.py` (10 cases) asserts every header is present on `/login`, on the root redirect, on a 401, on an authed `/api/summary`, and on a static asset; parametrises across every CSP directive; and pins `script-src` to `'self'` only.
- New `tests/test_static_assets.py` (7 cases) treats the served HTML/JS as data and asserts: no `on*=` attributes in `index.html`, `login.html`, or any template string in `app.js`; every `<script src=…>` points at `/static/`; no `<script>` block lacks a `src`; no `cdn.jsdelivr.net`/`fonts.googleapis.com`/`fonts.gstatic.com` references survive anywhere; and the three vendored files exist on disk.

Affected files: `app.py` (one import + one `add_middleware` line), new `security.py`, `static/index.html`, `static/login.html`, `static/app.js` (template literals + new dispatcher), new `static/theme-bootstrap.js`, new `static/login.js`, new `static/vendor/chart.umd.min.js`, new `static/vendor/inter/inter.css`, new `static/vendor/inter/inter-latin.woff2`, new `tests/test_security_headers.py`, new `tests/test_static_assets.py`. After all changes: `./venv/bin/ruff check .` → **All checks passed**; `./venv/bin/pytest` → **179 passed** (158 prior + 21 new); `./venv/bin/pytest tests/e2e` → **34 passed**.

---

## [0.14.1] — 2026-05-20

### Changed

- **`CLAUDE.md` now mandates running both test suites before committing.** The previous instructions documented only the default `./venv/bin/pytest` invocation, which `pytest.ini` runs with `--ignore=tests/e2e`. As a result the Playwright e2e suite (excluded from CI for the same reason) was easy to miss during local verification, and at least one stale assertion (`test_prefs_persist_across_sessions`, broken since v0.11 added `base_currency` to the prefs response) reached the working tree unnoticed. The updated "Running tests" section now lists both invocations (`./venv/bin/pytest` plus `./venv/bin/pytest tests/e2e`), spells out why the e2e suite is opt-in by default, names the one-time `playwright install chromium` setup step, and requires both suites to pass before a change is considered complete. The stale "112 tests" count is also removed — the unit/API suite has grown past that, and pinning a number in instructions just creates drift. Affected files: `CLAUDE.md`.

---

## [0.14.0] — 2026-05-20

### Added

- **AGPL-3.0 license.** The repository now carries an explicit `LICENSE` file containing the verbatim GNU Affero General Public License v3.0 text (fetched from GitHub's canonical licenses API). Until now the project had no license declared, which under default copyright law meant "all rights reserved" — no one but the author was legally permitted to fork, modify, or redistribute the code, which is a poor fit for a self-hosted project that has been public on GitHub since its first commit. AGPL-3.0 was chosen to match the licensing of the closest comparable self-hosted finance projects (Firefly III, Actual Budget, Maybe Finance), so contributors moving between them find familiar terms, and because the AGPL's network-use clause is the right default for a project people will self-host as a service: it permits personal use and modification but requires anyone running a modified version as a public-facing service to share their changes back. Affected files: `LICENSE` (new, 662 lines, full AGPL-3.0 text), `README.md` (new top-level "License" section after "Security Notes" plus a matching Table of Contents entry).

---

## [0.13.1] — 2026-05-20

### Fixed

- **Settings header icon now renders as a gear instead of a sun.** The SVG for the settings button was a near-duplicate of the light-mode toggle icon (a circle with eight radial spokes), so the gear/cog the button claimed to represent never appeared. Replaced the path with a proper cog outline + inner circle. Affected: `static/index.html`.
- **Mobile rendering of the header and modals.** On viewports below ~500px the header tried to fit six items (logo, net worth, username, sign-out, theme toggle, settings, "+ Add Account") on a single 64px row, pushing controls offscreen or squashing the net-worth value. The header now wraps, the redundant username is hidden, net worth moves to its own row on the narrowest screens, and "+ Add Account" collapses to just "+". Charts also drop slightly in height so they don't dominate the viewport, and the settings modal stacks its label/control pairs to stop them being squashed. Affected: `static/style.css`, `static/index.html`.

---

## [0.13.0] — 2026-05-19

### Rebranded from FinDash to PiLedger

The project's prior name (FinDash) clashed with an existing commercial product in the same space, so the GitHub repository was renamed to `piledger` and every in-tree reference now reads "PiLedger" (display) / `piledger` (identifiers). This is purely a rebrand — every feature, the schema, and every API contract are unchanged.

#### Why a single coordinated rename

The two-layer alternative (rebrand the docs and display strings now, leave runtime identifiers for later) was explicitly rejected. Splitting the change would mean shipping a build where users see "PiLedger" in the browser title and header but find a `findash_session` cookie in their devtools and a `findash.db` file on disk — confusing for newcomers who're reading the README and seeing inconsistent names depending on where they look. One coordinated commit is jarring exactly once; a phased rebrand is jarring forever.

The historical changelog entries below have been rewritten in-place to match — they originally described features by their then-current names (FINDASH_DB, FinDash, etc.). Leaving them unchanged would mean a reader trying to understand "when was the env var added?" would find `FINDASH_DB` in the history but `PILEDGER_DB` in the code with no breadcrumb between them. Since nothing about the substance of those past changes shifts, a verbatim rename keeps the history accurate against the current codebase.

#### Migration for existing self-hosters

The breaking changes are all renames — there are no removed features or schema migrations. Existing deployments need to update a handful of identifiers; afterwards everything behaves as before.

| What was | What it is now | How to migrate |
|---|---|---|
| `FINDASH_DB` env var | `PILEDGER_DB` | Rename the variable in your shell profile / systemd unit / `.env` |
| Default DB filename `findash.db` | `piledger.db` | Rename the file: `mv findash.db piledger.db` (if you used the default path), or pass the old path via `PILEDGER_DB=/path/to/findash.db` |
| Session cookie `findash_session` | `piledger_session` | No action — users are logged out once and need to sign in again |
| LocalStorage keys `findash:theme` / `findash:dark` | `piledger:theme` / `piledger:dark` | No action — themes are also stored server-side in `/api/prefs`, so refreshing the page repopulates localStorage from the API |
| Dummy hash salt `__findash_dummy__` | `__piledger_dummy__` | No action — the dummy hash is regenerated on first login attempt |
| Docker image / container / service / volume names `findash*` | `piledger*` | `docker compose down`, optionally `docker volume create piledger_piledger-data` and copy data from the old volume, then `docker compose up -d`. For a clean start: `docker compose down -v && docker compose up -d` |
| Process / log / PID filenames (`findash.log`, `findash.pid`, `findash.service`) in the README's systemd snippet | `piledger.log`, `piledger.pid`, `piledger.service` | Rename your unit file and reload: `sudo systemctl daemon-reload` |

#### Changed

- **Display strings** — header logo, browser `<title>` on both `index.html` and `login.html`, FastAPI app title, module docstrings, README + CHANGELOG + CLAUDE.md all read "PiLedger".
- **Code identifiers** — `constants.py` env var key (`PILEDGER_DB`), default DB filename (`piledger.db`), `SESSION_COOKIE = "piledger_session"`, `auth.py` dummy-hash salt (`__piledger_dummy__`), `static/app.js` + `static/index.html` + `static/login.html` use `piledger:theme` / `piledger:dark` localStorage keys.
- **Docker resources** — `Dockerfile` non-root user is `piledger`, env var is `PILEDGER_DB=/data/piledger.db`. `docker-compose.yml` service / `container_name` / `image` are `piledger`, named volume is `piledger-data`.
- **Tests** — `tests/test_auth.py` cookie assertions reference `piledger_session`. `tests/e2e/conftest.py` reads `PILEDGER_DB`, `PILEDGER_E2E_HEADED`, `PILEDGER_E2E_SLOWMO`. `tests/e2e/test_theme_persistence.py` asserts on the new localStorage keys.

After all changes: `./venv/bin/ruff check .` → **All checks passed**; `./venv/bin/pytest` → **158 passed** (no behavioural changes; only identifier names moved).

---

## [0.12.0] — 2026-05-19

### One-command setup with Docker Compose + uv-friendly install instructions

Up to now the only documented way to run PiLedger was the `python3 -m venv venv && pip install ...` dance, which is fine for the existing developer but adds friction for anyone trying the project for the first time. This release ships a containerised setup path and a top-level `Getting Started` section in the README so the on-ramp is clear regardless of how someone prefers to run Python services.

#### Design — Docker layout

- **Slim base, multi-layer cache.** The `Dockerfile` uses `python:3.12-slim` and copies `requirements.txt` *before* the application source, so editing `app.py` doesn't bust the dependency layer on every rebuild. `pip install --no-cache-dir` keeps the image lean.
- **Non-root by default.** A dedicated `piledger` system user (UID 10001) owns `/app` and `/data`. The container has no shell entrypoint, no sudo, and no need for privileged mounts — running it as root would have been a one-line shortcut that wasn't worth the security regression.
- **Data lives in a named volume.** `docker-compose.yml` mounts `piledger-data` at `/data` inside the container and sets `PILEDGER_DB=/data/piledger.db` in the environment. `docker compose down` keeps user data; `docker compose down -v` wipes it. This means image rebuilds (e.g. after `git pull`) never destroy user accounts or balance history — a property the old "edit `piledger.db` in place" workflow didn't even need to think about because there was no rebuild step.
- **Built-in health check.** Both the `Dockerfile` `HEALTHCHECK` and the compose-level `healthcheck` hit `GET /login`, which returns 200 unauthenticated. Plain `GET /` returns a 302 redirect to `/login` which makes for a noisier check; `/login` is the most direct "is the SPA wired up" probe we can make without a session cookie.

#### Design — README Getting Started

The new section sits at the top of the README and presents three equally-supported install paths (Docker, `uv`, `pip` + `venv`) in a single decision table. The existing `Building and Running` section stays as the deep reference for systemd, headless deployment, and firewall config — newcomers find the short recipe up top without losing the operational notes lower down.

`uv` got first-class treatment in addition to `pip` because installing the runtime + dev dependencies via `pip` takes 20–30 seconds even on a fast connection, while `uv pip install -r requirements.txt` is usually under two. Using `uv venv venv` (rather than the default `.venv`) keeps the layout identical to the pip flow so `start.sh`, the systemd unit, and `./venv/bin/pytest` all work unchanged.

#### Added

- `Dockerfile` — Python 3.12-slim image, dependency layer cached separately from source, `piledger` non-root user, writable `/data` for the SQLite volume, `HEALTHCHECK` against `/login`, CMD `uvicorn app:app --host 0.0.0.0 --port 8080`.
- `docker-compose.yml` — single `piledger` service, `restart: unless-stopped`, `8080:8080` port mapping (host-side configurable), `PILEDGER_DB` pinned to `/data/piledger.db`, `COOKIE_SECURE` passed through from the host env, named `piledger-data` volume, healthcheck mirroring the Dockerfile probe.
- `.dockerignore` — excludes `venv/`, `.git/`, `*.db` (most importantly the host's `piledger.db` — keeps user data out of the image), `tests/`, `__pycache__/`, `.ruff_cache/`, `.pytest_cache/`, `.env*`, `.claude/`, and editor/OS noise. Keeps the build context small and prevents host-side artefacts from leaking into layers.
- `README.md` — new top-level `Getting Started` section with a three-row decision table (Docker / uv / pip + venv), full Docker workflow including `down`/`down -v`/`cp` data-backup recipes, parallel pip and uv recipes for local dev. The existing `Building and Running` section is updated to acknowledge both pip and uv as supported and now cross-references `Getting Started` for the Docker path. The `File Structure` table grows entries for `Dockerfile`, `docker-compose.yml`, and `.dockerignore`. The Table of Contents is renumbered to include the new section.

After all changes: `./venv/bin/ruff check .` → **All checks passed**; `./venv/bin/pytest` → **158 passed** (no changes to application code).

---

## [0.11.0] — 2026-05-19

### Multi-currency accounts with a user-selected base for net-worth totals

Until now PiLedger assumed everything was in GBP — every balance, every chart, every summary tile hardcoded the `£` symbol. This release adds first-class support for holding accounts in different currencies, with each user picking a single "base" currency that totals and net-worth figures are reported in.

#### Design — per-account currency + user base + manual rates

Three design decisions shape the implementation:

- **Currency lives on the account.** A new `accounts.currency` column means each account is denominated in one currency that never changes implicitly. Per-account balances always render in that currency in the UI — `$2,000` stays `$2,000` even after the base changes.
- **A user-level base currency drives every aggregate.** `users.base_currency` is what `/api/summary`, the net-worth header, and the budget projection's net-worth line all report in. The frontend converts each account into the base on the fly when computing the doughnut distribution and the table's net-worth row, so a portfolio split across GBP / USD / EUR collapses to a single comparable number.
- **Rates are manual, not fetched.** A new `exchange_rates(user_id, currency, rate)` table holds per-user manual rates; there is no outbound API call, no scheduled job, no API-key plumbing. Users maintain the table from Settings whenever it matters. Picked this over auto-fetched rates because (a) it has zero external dependencies and never breaks on rate-limit/quota issues, (b) tests stay deterministic with no network mocking, and (c) for a self-hosted personal dashboard the friction of re-entering a few rates monthly is lower than the friction of integrating an exchange-rate provider.

A missing rate is not an error — `/api/summary` falls back to 1.0 so the total is never silently dropped, but it returns the missing currencies in a `missing_rates` array so the UI can warn (the net-worth label gains a `⚠` and a tooltip listing the affected currencies). The frontend mirrors the same fallback for client-side conversion (distribution doughnut, breakdown-table net-worth row).

When the base currency changes via `PUT /api/prefs`, the rates table is recomputed in place: if you had `USD → GBP = 0.5` and switch base to USD, the row becomes `GBP → USD = 2.0`, and any third currency (e.g. EUR) is re-scaled by dividing its old rate by the pivot. If no pivot is available (e.g. switching to a base you'd never set a rate for) the table is cleared rather than producing nonsense — the user re-enters what they need.

#### Storage

All balances continue to be stored as integer 100ths of the major unit (the existing `balance_cents` column). For JPY (which has no minor unit), that means ¥1,000 is stored as 100000; the UI rounds to whole yen on display via `Intl.NumberFormat`'s `minimumFractionDigits: 0`. Keeping the storage scheme uniform across currencies means no migrations to any of the money columns and no per-currency precision logic in the cents/dollars conversion.

#### Added

**Backend**

- `constants.py` — `Currency` literal (`GBP`, `USD`, `EUR`, `JPY`, `CAD`, `AUD`, `CHF`, `NZD`, `SEK`, `NOK`) plus the matching `SUPPORTED_CURRENCIES` set, `CURRENCY_INFO` metadata (symbol + decimals per code), and `MIN_RATE_FX` / `MAX_RATE_FX` bounds. `DEFAULT_CURRENCY = "GBP"` keeps backfilled rows behaving exactly as before.
- `db.py` — `accounts.currency TEXT NOT NULL DEFAULT 'GBP'` column; `users.base_currency TEXT DEFAULT 'GBP'` column; new `exchange_rates(user_id, currency, rate, updated_at)` table keyed by `(user_id, currency)` with `ON DELETE CASCADE` so a user's rates evaporate when their account does. Additive migration blocks check `PRAGMA table_info` before each `ALTER TABLE` so existing `piledger.db` instances upgrade cleanly without losing data.
- `schemas.py` — `AccountIn`/`AccountPatch`/`AccountOut` gain a `currency: Currency` field; `PrefsOut`/`PrefsPatch` gain `base_currency`; `SummaryOut` gains `base_currency` + `missing_rates: list[Currency]`; new `RateIn`, `RateOut`, `RatesPut`, `RatesOut` model the new `/api/rates` endpoint.
- `app.py` — `GET /api/rates` and `PUT /api/rates` for managing the manual table (PUT validates `currency != base_currency` and rejects duplicates before any write so a 400 never leaves a half-updated row). `_load_rates`, `_convert_to_base`, and `_rescale_rates` helpers centralise the conversion logic so summary, projections, and budget all share one implementation. `/api/summary` reads the user's base + rates and converts each account before adding to the relevant pot; `/api/budget/projection` computes per-account points in the account's native currency but converts to base when summing the net-worth line; `/api/history/all` and `/api/projections` carry `currency` through to the response so the frontend can format tooltips correctly.

**Frontend**

- `static/index.html` — Add-Account modal gains a Currency dropdown (defaults to the user's base). Settings modal grows two new sections: a Base Currency dropdown and an Exchange Rates table that only lists currencies actually held by the user. Static `£` symbols in modal labels are removed in favour of dynamic injection from the currently-selected currency.
- `static/app.js` — `CURRENCIES` table (id → label, symbol, decimals) drives the dropdowns and `Intl.NumberFormat` calls. `fmt(value, code)` / `fmtSigned(value, code)` accept an optional currency override so per-account values format in their native currency while totals continue formatting in the base. Chart tooltips read `dataset._currency` so a mixed-currency history or budget chart renders each line in its own currency. The doughnut distribution converts each slice to the base before summing for the chart, but the tooltip still shows the native amount with an `(≈ X base)` suffix when they differ. `loadRates()` runs on boot alongside `loadPrefs()`; `onBaseCurrencyChange` calls `PUT /api/prefs` and refreshes the dashboard; `saveRatesFromTable` collects the rate inputs and PUTs the whole table. `renderSummary` reads `s.missing_rates` and toggles a `.nw-label--warn` class with a tooltip enumerating the affected currencies.
- `static/style.css` — `.badge-currency` chip (sits next to type/subtype badges, only shown when the account's currency differs from the base); `.rates-table` + `.rate-row` styles for the Settings rates editor; `.nw-label--warn` adds amber colour and a trailing `⚠` to the Net Worth header when rates are missing.

**Tests**

- `tests/test_currency.py` — 20 new tests covering account currency defaults + validation, base-currency round-trip through `/api/prefs`, the `/api/rates` GET/PUT round-trip with replace semantics + duplicate/zero/self-base rejection, cross-user isolation, FX-aware `/api/summary` totals (including loans subtracting in base), missing-rate flagging, and the rate-rescaling behaviour when the base currency changes (with and without a pivot rate).
- `tests/test_dashboard.py`, `tests/test_prefs.py` — updated three response-shape assertions to include the new `base_currency` / `missing_rates` keys.

After all changes: `./venv/bin/ruff check .` → **All checks passed**; `./venv/bin/pytest` → **158 passed** (138 existing + 20 new).

---

## [0.10.0] — 2026-05-19

### Continuous integration via GitHub Actions

Every push to `main` and every pull request now runs a CI pipeline in a fresh Ubuntu environment, so regressions and lint drift are caught before review instead of after merge. The pipeline has two parallel jobs:

- **Lint** — installs [ruff](https://docs.astral.sh/ruff/) and runs `ruff check` against the whole repo. Ruff was picked over flake8/pylint because it's orders of magnitude faster (the entire repo lints in milliseconds), bundles the rules we'd otherwise pull in piecemeal, and needs no config to be useful. Output uses `--output-format=github` so violations annotate the offending lines inline on the PR diff.
- **Tests** — installs `requirements.txt` + `requirements-dev.txt` against Python 3.12 and runs `pytest`. The existing `pytest.ini` already excludes `tests/e2e` from the default invocation, so the Playwright browser suite — which needs a Chromium download and system libs — is intentionally skipped in CI. The 138 unit/API tests do run.

#### Added

- `.github/workflows/ci.yml` — two-job workflow (`lint`, `test`) triggered by `push: branches: [main]` and `pull_request:`. The branch filter on `push` plus the unconstrained `pull_request` avoids the common double-trigger where a PR branch push fires both events; only `main` pushes and PR events run, which is enough to gate merges. The test job uses `actions/setup-python@v5`'s built-in `cache: pip` keyed off both requirements files so repeat runs reinstall from cache.
- `requirements-dev.txt` — added `ruff>=0.6` so local dev environments use the same linter CI runs.

#### Fixed

- `tests/e2e/conftest.py`, `tests/e2e/test_balance_validation.py` — removed two unused imports (`sys`, `re`) flagged by `ruff check` (F401). These were the only lint violations in the codebase; fixing them lets the new lint job land green.

After all changes: `./venv/bin/ruff check .` → **All checks passed**; `./venv/bin/pytest` → **138 passed** (unchanged).

---

## [0.9.0] — 2026-05-19

### Summary tiles double as account-grid filters

The four tiles along the top of the Overview (Total Savings, Current Accounts, Total Debt, Accounts) used to be display-only. They now act as type filters for the Accounts grid below: click Savings to see only savings cards, click Current to swap to current, etc. The cards below narrow but the dashboard-wide totals, charts, and Distribution stay global so you don't lose context when drilling in.

#### Added

**Frontend**
- `static/index.html` — each summary tile is now a `<button type="button" class="card summary-card" data-filter="…" aria-pressed="…">`. `data-filter` is one of `savings`, `current`, `loan`, `all`; `aria-pressed` reflects the active tile. The 'Accounts' (count) tile starts as the active "all" filter. Inner DOM (icon + label + value) unchanged, so every existing selector keeps working.
- `static/app.js` — `state.accountFilter` (null = show all). `setAccountFilter(type)` toggles when re-clicking the active filter, special-cases `'all'` as a clear, updates `aria-pressed` on every tile, and re-renders the grid. `renderAccounts` narrows by `state.accountFilter` before render, and shows a friendly empty state with a "Show all" escape hatch when a filter matches zero accounts. The filter survives `loadAll()` re-renders (e.g. after updating a balance) because the state lives at module scope, not on the DOM.
- `static/style.css` — `.summary-card` resets native button styling (text-align, font, color, width, cursor), gains a subtle hover lift + `:focus-visible` ring, and `[aria-pressed="true"]` renders an accent border + ring so the active filter is unmistakable.

#### Why filter the grid only, not the charts
The summary numbers ("£3,250 across 3 accounts") describe your whole financial picture, not your current view. If clicking Savings rewrote them, the user would lose the very context they're trying to drill into. Same logic for Balance History and Distribution — they show how your money is split *because* you want to compare types, so filtering them away from the same click defeats the chart's purpose.

**Tests**
- `tests/e2e/test_account_filters.py` (7 tests, all chromium) — default state shows all 3 accounts with the count tile active; clicking Savings narrows to one card; clicking Current swaps filter; clicking the active filter again clears; the count tile always clears; an empty result shows the "No X accounts" empty state with a "Show all" button; **filter survives balance update** (loadAll re-render doesn't snap the user back to the full list).

After all changes: `./venv/bin/pytest` → **138 passed** (unchanged); `./venv/bin/pytest tests/e2e` → **34 passed** (27 → 34).

---

## [0.8.0] — 2026-05-19

### Playwright end-to-end test suite

The existing 138-test pytest suite covers the HTTP API exhaustively, but every test runs against `starlette.testclient.TestClient` — meaning regressions that only show up in a real browser (broken SVG icons, modals that don't open, dark-mode CSS that fails to swap, theme prefs that don't round-trip through the dashboard's `loadPrefs() → applyTheme()` boot sequence) could ship without anyone noticing. This release adds a Playwright suite that drives a real Chromium against a live Uvicorn instance.

#### Added

**Test infrastructure**
- `tests/e2e/conftest.py` — session-scoped `live_server` fixture boots Uvicorn against an isolated temp DB (via the `PILEDGER_DB` env var that `constants.DB` reads at import) on a dynamically-allocated port, so the suite never collides with the dev server on :8080. `signed_in_page` and `registered_user` fixtures handle the boilerplate of getting into the dashboard. `PILEDGER_E2E_HEADED=1` and `PILEDGER_E2E_SLOWMO=250` honoured for local debugging.
- `pytest.ini` — registered an `e2e` marker and added `--ignore=tests/e2e` to default `addopts`. This keeps `./venv/bin/pytest` fast (138 unit/API tests, ~34s) and makes the browser suite explicit: `./venv/bin/pytest tests/e2e`.
- `requirements-dev.txt` — added `pytest-playwright>=0.5`. The browser binary is installed via `./venv/bin/playwright install chromium`; system libraries via `sudo ./venv/bin/playwright install-deps chromium` (one-time).

**Tests (27 total, all chromium-only)**
- `tests/e2e/test_auth_flow.py` (5 tests) — unauthenticated `/` redirects to `/login`; the register-tab → auto-login → dashboard flow; mismatched passwords blocked client-side; wrong password surfaces the API error; sign-out clears the cookie so a subsequent `/` bounces back to `/login`.
- `tests/e2e/test_icons_render.py` (5 tests) — every static SVG icon (header logo, theme toggle, settings cog, the four summary-card icons, the empty-state placeholder, the login-page logo) is asserted both `visible` *and* with a non-zero bounding box, so a CSS regression that hides or collapses an icon fails the test. Dark-mode toggle also verified to flip the moon/sun visibility pair driven by `[data-mode="dark"] .theme-toggle .icon-*`.
- `tests/e2e/test_balance_validation.py` (6 tests, incl. 2 parametrised) — blank account name caught by the `submitAddAccount` alert path; negative balance flagged invalid by the `min=0` HTML5 constraint; balance exceeding `MAX_MONEY` (±£1T) rejected by the server's `BalanceIn.balance` Pydantic bound and surfaced as an `Error:` alert; non-numeric input caught by the `parseFloat` NaN path; out-of-range interest rate (-1, 1500%) rejected by `AccountIn.interest_rate` (`MAX_RATE=1000`).
- `tests/e2e/test_theme_persistence.py` (4 tests) — switching theme updates `html[data-theme]` and `localStorage`; toggling dark mode updates `html[data-mode]` and `localStorage`; **the cross-session test** signs in, switches to indigo + dark, asserts `/api/prefs` reflects it, signs out, **clears localStorage**, signs back in, and asserts the dashboard re-hydrates the same theme from the API — proving persistence is server-side, not just browser-cached. The active-swatch test verifies the settings modal moves its `.active` highlight when the theme changes.
- `tests/e2e/test_account_flows.py` (7 tests) — full add-account flow with summary cards updating; balance update with notes reflected in card + total; loan accounts classified into `#total-loans` not `#total-savings` and labelled APR not AER; the subtype dropdown repopulating to a valid set when the parent type changes (no submitting `current+mortgage`); rename via the edit modal; delete via the confirm-delete modal returning the empty state; view switcher between Overview and Budget Planner.

After all changes: `./venv/bin/pytest` → **138 passed** (fast suite unchanged); `./venv/bin/pytest tests/e2e` → **27 passed** in ~27s.

---

## [0.7.0] — 2026-05-19

### UK Account Sub-types

A second dropdown on the Add Account modal lets users record what kind of current / savings / loan account they're tracking. Until now the three-way type was the only categorisation, which forced an ISA, a regular saver, a SIPP and an instant-access pot into the same `savings` bucket — losing useful information at the point of entry. The default sub-type is `general`, so users who don't care about that level of detail are unaffected.

#### Added

**Backend**
- `constants.py` — new `AccountSubtype` Literal covering UK-market account flavours: 6 current-account types (standard, joint, student, premier, basic, business), 11 savings types (cash ISA, stocks & shares ISA, lifetime ISA, junior ISA, regular saver, easy access, fixed-term bond, notice account, premium bonds, SIPP, workplace pension), and 7 loan types (bank loan, credit card, mortgage, student loan, car finance, overdraft, BNPL). Plus a `general` value valid for every parent type. A `SUBTYPES_BY_TYPE` mapping enforces which sub-types are valid for each parent type so the API can reject combos like `type=current, subtype=mortgage`.
- `db.py` — `accounts.subtype` TEXT column added with default `'general'`. Additive `ALTER TABLE` migration so pre-existing rows pick up the default automatically; no recreation of the table needed.
- `schemas.py` — `AccountIn` / `AccountOut` / `AccountPatch` carry a `subtype` field. `AccountIn` uses a `model_validator` so type/subtype combinations are validated at request time. `AccountPatch` cannot be validated by Pydantic alone (the parent `type` is not in the payload), so the app-level handler does that cross-check against the persisted row.
- `app.py` — `POST /api/accounts` persists the chosen sub-type; `PUT /api/accounts/{id}` accepts a `subtype` patch and rejects 400 if the new value isn't valid for the existing row's type. The existing `RequestValidationError → 400` handler now coerces `ctx` values to strings so `ValueError`s raised by `model_validator` don't crash JSON serialisation.

**Frontend**
- `static/index.html` — Add Account modal gains an `Account Subtype` dropdown directly under the type selector. Edit Account modal gets the same dropdown so users can re-classify after the fact.
- `static/app.js` — a `SUBTYPES` catalog provides display labels ("Cash ISA", "Stocks & Shares ISA", "SIPP (Self-Invested Pension)", "Buy Now, Pay Later", …) keyed by parent type and value. `populateSubtypeSelect` rebuilds the dropdown whenever the user switches the parent type, ensuring the available options are always valid. Account cards now show a secondary badge with the sub-type label when it is anything other than `general`.
- `static/style.css` — `.badge-subtype` styling: a muted slate chip with mixed-case text so it reads as a sub-label next to the bold uppercase type badge.

**Tests**
- `tests/test_subtypes.py` — 13 new tests covering: default value, round-trip on list, per-type acceptance of every valid sub-type, the universal `general` value, cross-type rejection (mortgage on current, cash_isa on loan), unknown values rejected with 400, and PATCH semantics including the "PATCH without subtype leaves it unchanged" case.

After all changes: `./venv/bin/pytest` → **125 passed** (112 → 125).

---

## [0.8.0] — 2026-05-19

### Appearance settings — olive theme, palette picker, light/dark mode

A Settings modal (gear icon in the top-right header cluster) now lets each user pick a colour palette and toggle between light and dark mode. Olive is the new default. The picker offers four palettes (Olive, Indigo, Slate, Rose); preferences are stored per user so they follow across browsers / devices.

#### Added

**Backend**
- `constants.py` — `Theme` Literal of allowed palette ids (`olive` / `indigo` / `slate` / `rose`) plus `DEFAULT_THEME`. The Pydantic schema relies on this so unknown values are rejected with 400 before they hit SQLite.
- `db.py` — `users.theme` (TEXT, default `'olive'`) and `users.dark_mode` (INTEGER 0/1) columns. Additive `ALTER TABLE` migrations populate existing rows with the defaults so the upgrade is silent for pre-0.8.0 databases.
- `schemas.py` — `PrefsOut` and `PrefsPatch` schemas. Partial PATCH semantics: omitted fields are left as-is, `extra="forbid"` rejects unknown keys.
- `app.py` — `GET /api/prefs` and `PUT /api/prefs`. SQLite has no native bool so `dark_mode` is cast to `int` on write and back to `bool` on read.

**Frontend**
- `static/style.css` — full theme variables overhaul. Default `:root` switched from indigo (`#6366f1`) to olive (`#708238`). Alternative palettes are one-liners under `[data-theme="..."]` that just override the accent triplet; `--accent-lt` and `--accent-ring` use `color-mix(in srgb, ...)` so they regenerate themselves whenever either the theme or the surface (light/dark) changes. Dark mode lives under `[data-mode="dark"]` and re-targets surface tones, semantic pastels (green/red/amber chips), and shadow opacities. Replaced every hardcoded indigo / slate hex (`--indigo-lt`, `--indigo-dk`, `rgba(99,102,241,.12)` focus ring, the `#fee2e2` loan badge, etc.) with semantic variables so swapping themes restyles every accent-aware element automatically.
- `static/style.css` — new styles for `.header-icon-btn` (round 34px subtle button used by both header icons), `.theme-toggle .icon-sun/.icon-moon` (so the icon flips automatically based on `[data-mode]`), `.theme-swatch` (palette picker tile with active border ring), and `.mode-pill` (compact pill for light/dark inside the settings modal).
- `static/index.html` — added `theme-toggle` and `btn-open-settings` icon buttons in the header's top-right cluster, plus the Settings modal containing the Appearance row (light/dark pill) and the colour-theme grid. Logo SVG fill switched from hardcoded `#6366f1` to `currentColor` so it inherits the active accent.
- `static/index.html` / `static/login.html` — inline pre-paint script that reads `piledger:theme` / `piledger:dark` from `localStorage` and stamps the `<html>` element with the right `data-theme` / `data-mode` before stylesheet eval, avoiding the flash-of-default-theme that would otherwise show on every page load.
- `static/app.js` — `THEMES` catalog + `prefs` state, `applyTheme()` writes the DOM attributes and mirrors to localStorage, `loadPrefs()` is called at boot before `loadAll()`. Settings handlers (`setTheme`, `setDarkMode`, `toggleDarkMode`) optimistically apply, re-render charts, and PUT to `/api/prefs`. Chart text/grid colours now read from CSS variables via `cssVar('--muted')` / `cssVar('--border')` / `cssVar('--surface')` so re-rendering after a theme switch picks up the new palette without any per-chart configuration.
- `static/login.html` — logo SVG fill swapped to `currentColor` so the login page inherits whatever palette is cached for this browser.

**Tests**
- `tests/test_prefs.py` — 13 new tests covering: defaults for new users, auth required on both GET + PUT, single-field and combined PUTs, partial PATCH semantics, empty-PATCH no-op, invalid theme rejected with 400, `extra="forbid"` enforcement, every allowed theme accepted, full cross-user isolation (alice's prefs don't leak to bob, and either user can change their own without affecting the other).

After all changes: `./venv/bin/pytest` → **138 passed** (125 → 138).

---

## [0.6.2] — 2026-05-19

### Docs

**README + CLAUDE.md synced to current code.** The README dated from the 0.1.0 release and had drifted on every feature shipped since. This pass updates only the inaccurate facts; the document's structure and prose are unchanged.

- `README.md` — Architecture + File Structure now reflect the 5-module backend split (`app.py`, `auth.py`, `db.py`, `constants.py`, `schemas.py`) introduced in commit `c180dbd`. Tree includes `tests/`, `pytest.ini`, `requirements-dev.txt`, `CHANGELOG.md`, `CLAUDE.md`, `.gitignore`.
- `README.md` — Database Schema: `accounts.type` now lists `'loan'`; `balance_history.balance REAL` corrected to `balance_cents INTEGER`; the missing `budget_items` table added; the schema-migration paragraph expanded from 1 to 4 migrations (user_id, loan type widening, balance cents, budget amount cents).
- `README.md` — Requirements table: R4 widened to include loans; new rows R12 (budget planning) and R13 (loan/debt tracking).
- `README.md` — API Reference: added the entire Budget Planner section (`GET/POST/PUT/DELETE /api/budget`, `GET /api/budget/projection`); fixed `/api/summary` shape to include `total_loans` and to document `total` as net worth; added a Projection-calculation breakdown for the budget projection formula; added an Error-responses subsection documenting 400/401/404/409.
- `README.md` — Frontend: documented the nav tabs, the Budget Planner view, the 4 summary cards (added Total Debt), the Budget chart, the 6 modals (was 4), and the expanded `state` object including budget fields.
- `README.md` — Authentication: documented the `COOKIE_SECURE` env var and the opportunistic expired-session purge inside `make_session()`; added a subsection on the dummy-hash timing-attack mitigation in `verify_password`.
- `README.md` — Building: setup command uses `pip install -r requirements.txt`; added `requirements-dev.txt` step; new Environment Variables table for `PILEDGER_DB` and `COOKIE_SECURE`.
- `README.md` — Testing: replaced the "No automated test suite is included" claim with a description of the actual 112-test pytest suite, including a per-file breakdown. The curl smoke-test recipes are retained under a new "Manual smoke tests" subsection.
- `README.md` — Security Notes: HTTPS note now references `COOKIE_SECURE`; the "expired session rows are never purged" claim corrected to reflect `make_session`'s opportunistic cleanup.
- `CLAUDE.md` — test count updated from 99 → 112.

---

## [0.6.1] — 2026-05-19

### Fixed

**Test suite broken by auth/db refactor**

The refactor that split `app.py` into `auth.py`, `db.py`, `constants.py`, and `schemas.py` (commit `c180dbd`) regressed two things that the test suite caught only after rerun:

- `tests/conftest.py` was still monkeypatching `app.DB`, but the `DB` constant had moved to `constants.py` (`db.db()` reads `constants.DB` at call time). Every test errored out at fixture setup with `AttributeError: module 'app' has no attribute 'DB'`. Fixed by patching `constants.DB` instead — one-line change, plus a docstring update describing the new attachment point.
- Bad-input validation that previously raised `HTTPException(400, ...)` inline was moved into Pydantic `_In` schemas in `schemas.py`. Pydantic's default failure code is `422`, so the public contract documented in `README.md` (lines 145, 441-447) and the 0.6.0 CHANGELOG entry ("returns `400` for anything else") silently drifted. Added a `RequestValidationError` handler in `app.py` that returns `400` with the Pydantic error payload, restoring the documented status code without losing the structured error detail.

After both fixes: `./venv/bin/pytest` → **112 passed**.

### Changed

**Loan budget UX — minimum monthly payment**

The budget section's "Money in / Money out" paradigm reads naturally for current and savings accounts but is counter-intuitive for loans, where the only useful budget concept is the monthly payment. This release reframes the loan flow without changing the underlying data model — loan payments are still stored as negative monthly `budget_items`, but the user never has to think in those terms.

- `static/index.html` — **Add Account modal**: new optional `Minimum Monthly Payment (£)` field shown only when type=Loan. The existing "Opening Balance" label switches to **"Amount Owed"** for loans so the field reads as a liability rather than an asset.
- `static/index.html` — **Budget Item modal**: the direction toggle and frequency dropdown are wrapped in fields with IDs (`bim-direction-field`, `bim-frequency-field`), and the amount label gained an id (`bim-amount-label`) so they can be hidden / relabeled per account type. The account `<select>` now fires `onBudgetAccountChange()` when the user picks a different account so the form adapts live.
- `static/app.js` — `toggleAddInterest()` now also toggles the min-payment group and rewrites the balance label. `submitAddAccount()` creates the loan first, then issues a follow-up `POST /api/budget` with `amount = -minPay`, `frequency = 'monthly'`, `name = 'Minimum monthly payment'` when the min-payment field is populated.
- `static/app.js` — new `_applyBudgetModalForAccount(accountId)` helper inspects the selected account's type; for loans it hides the direction toggle and frequency field, relabels the amount as "Minimum Monthly Payment (£)", forces direction to "out" and frequency to "monthly", and defaults the description to "Minimum monthly payment" if blank. Invoked from `openAddBudgetModal`, `openEditBudgetModal`, and `onBudgetAccountChange` so the modal adapts whether opened from the toolbar, a per-account card, an edit click, or a mid-edit account switch.
- Backend untouched — `POST /api/budget`, the projection maths in `app.py`, and the existing tests in `tests/test_loans.py` all keep working because the on-disk representation of a loan payment is unchanged (negative amount, monthly frequency).

---

## [0.6.0] — 2026-05-18

### Loans & Debt Tracking

#### Added

**Backend**
- `'loan'` is now a valid account type alongside `'current'` and `'savings'`. Loans store their balance as a positive number (the amount owed) and accrue interest each month; budget items with negative amounts represent payments that reduce the balance.
- Schema migration in `init()` — uses `sqlite_master.sql` to detect tables created with the old `CHECK(type IN ('current','savings'))` constraint and recreates them with the wider `CHECK(type IN ('current','savings','loan'))` constraint, preserving all existing rows. Migration is a no-op for fresh databases.
- `GET /api/summary` now returns `total_loans` and computes `total` as **net worth** (current + savings − loans) instead of a flat sum of balances. The "Net Worth" figure in the header now reflects liabilities correctly.
- `POST /api/accounts` validates that `type` is one of `current`, `savings`, or `loan` and returns `400` for anything else (error message updated accordingly).
- `GET /api/budget/projection` response now includes a `net_worth` array — one entry per month — computed as `sum(assets) − sum(loans)`. Available even when there are no loans, so the frontend always has a single line representing overall trajectory.

**Frontend**
- Summary row expanded from 3 to 4 cards: Total Savings · Current Accounts · **Total Debt** · Accounts. Responsive breakpoints adjusted so the grid collapses to 2×2 below 960px and a single column below 500px.
- Add Account modal: the type dropdown gained a `Loan / Debt` option, and the interest-rate field now appears for both savings and loan accounts. The field label switches between "Annual Interest Rate (%)" and "APR (%)" based on the chosen type.
- Edit Account modal: same dynamic label behaviour; the rate field is shown for loans as well as savings.
- Account cards show loans with a red `loan` badge, label the rate as "APR" in red instead of green "AER", and replace "Updated:" with "Owed ·" so a high balance reads as a liability rather than an asset.
- Distribution doughnut chart now excludes loans — it shows where the user's **assets** are held, not their debts.
- Budget Planner projection chart includes a bold dark **Net Worth** line on top of the per-account lines, giving a single read of overall trajectory. Loan lines are rendered with a dashed stroke so a downward trend visually parses as "debt being paid down" rather than an asset losing value.
- Monthly Breakdown table totals row now shows **Net worth** (assets − liabilities) at each month, sourced from the new `net_worth` array. The monthly-net column flips the sign for loans so a payment of −£1,200 contributes +£1,200 to net worth growth.

**Tests**
- `tests/test_loans.py` — 12 new tests covering loan creation, summary inclusion, net worth subtraction, user isolation, interest accrual with no payments, balance reduction under payments, `net_worth` array shape, asset-only edge cases, and budget item round-trip on a loan account.
- `test_summary_empty` in `tests/test_dashboard.py` updated to include `total_loans: 0.0` in the expected response shape.

---

## [0.5.2] — 2026-05-17

### Security

- **`PILEDGER_DB` environment variable** — the database path is now read from `PILEDGER_DB` if set, falling back to `piledger.db` alongside `app.py`. Prevents the path from being baked into committed code and makes it easy to point different environments at different databases without editing source.
- **`COOKIE_SECURE` environment variable** — the session cookie now sets `Secure=True` when `COOKIE_SECURE=true` (or `1` / `yes`) is present in the environment. Defaults to `False` for plain HTTP, but should be enabled whenever the app is served over HTTPS.
- **`.gitignore`** — added to exclude `*.db` (user credentials and financial data), `venv/`, `__pycache__/`, `.pytest_cache/`, `.env` files, and `.claude/settings.local.json` (per-developer Claude Code permission allowlists). Nothing sensitive is included in the initial commit.

---

## [0.5.1] — 2026-05-17

### Fixed

- **Missing spacing between dashboard sections** — when the navigation tabs were introduced in 0.5.0, all overview sections (summary cards, accounts grid, charts row, savings projections) were wrapped in a `<div id="view-overview">`. The `gap: 28px` on `.main` only applies to direct children, so once those sections were no longer direct children of `.main`, all vertical spacing between them was lost. Fixed by adding `display: flex; flex-direction: column; gap: 28px` to both `#view-overview` and `#view-budget`, restoring consistent 28px gaps between every section in both views.

---

## [0.5.0] — 2026-05-17

### Budget Planner

A full budgeting view has been added alongside the existing dashboard, accessible via a persistent navigation bar at the top of the page.

#### Added

**Navigation**
- Sticky two-tab nav bar inside the header — "Overview" (existing dashboard) and "Budget Planner" (new view). Switching is instant; the budget view lazy-loads its data on first visit and does not re-fetch the overview unnecessarily.

**Backend**
- `budget_items` table — stores recurring cash-flow items per account: `name`, `amount` (positive = money in, negative = money out), `frequency` (`weekly` / `monthly` / `quarterly` / `annually`), foreign-keyed to both `users` and `accounts` with cascade deletion.
- `FREQ_TO_MONTHLY` constant — normalises weekly, quarterly, and annual amounts to their monthly equivalent before any projection is calculated.
- `GET /api/budget` — list all budget items for the authenticated user.
- `POST /api/budget` — create a budget item; verifies the target account belongs to the current user.
- `PUT /api/budget/{id}` — update a budget item's name, amount, or frequency.
- `DELETE /api/budget/{id}` — remove a budget item.
- `GET /api/budget/projection?months=3|6|12` — compute month-by-month projected balances for all accounts. Each month applies cash flows first, then compounds savings interest: `new_balance = (old_balance + monthly_net) × (1 + monthly_rate)`. Current accounts have `monthly_rate = 0`, so they simply accumulate net cash flows. Responds with per-account `monthly_net`, `points[]`, and `final_balance`. Returns `400` for any `months` value other than 3, 6, or 12.

**Budget Planner UI**
- Period selector — segmented control to switch between 3, 6, and 12-month projections; updates the chart and breakdown table without reloading items.
- **Projected Balances chart** — line chart with one series per account; a faint dashed red zero-reference line is injected automatically if any account is projected to go negative; subtitle notes that savings interest is included.
- **Budget Items grid** — one card per account, colour-coded with the account's chosen colour. Each card shows the account's total monthly net flow (+/−) and a list of its items with signed amounts. Per-account "+ Add" button pre-selects that account; global "+ Add Budget Item" button available in the toolbar.
- **Monthly Breakdown table** — sticky first column, one column per period from Now through the final month. Negative balances rendered in red. Totals row summarises net worth and combined monthly flow. Table is horizontally scrollable on narrow viewports.
- **Budget Item modal** (shared add / edit) — account selector (add only; account is fixed on edit), description field, direction toggle ("Money out" / "Money in" styled red/green), amount, frequency dropdown. Confirmation modal for deletion.

---

## [0.4.0] — 2026-05-17

### Test Suite

A complete automated test suite was introduced covering all application behaviour.

#### Added

- `tests/` directory containing 99 tests across 5 files.
- `tests/conftest.py` — shared pytest fixtures. The `app` fixture monkeypatches `app.DB` to a fresh `tmp_path` file and re-runs `app.init()`, giving each test a fully isolated SQLite database. `alice` and `bob` fixtures create authenticated `TestClient` instances that share the same test DB, enabling cross-user isolation tests.
- `tests/test_auth.py` (21 tests) — registration rules (minimum lengths, duplicate username, case-insensitivity), login, session cookie issuance, `/api/auth/me`, logout invalidation, token replay after logout, route-level redirect for unauthenticated users.
- `tests/test_accounts.py` (20 tests) — full CRUD lifecycle, creation order, partial updates, 404 on missing IDs, auth enforcement, complete cross-user isolation for list / update / delete.
- `tests/test_balances.py` (15 tests) — recording, latest-entry selection with multiple entries, notes, chronological ordering, `days` filter using back-dated `recorded_at`, cascade deletion, auth and isolation enforcement.
- `tests/test_dashboard.py` (25 tests) — summary totals across account types, correct use of latest balance only, user isolation; `history/all` inclusion / exclusion logic and date window filtering; projection maths verified against the compound-interest formula, zero-interest flat-line, point count, milestone consistency (1yr / 2yr / 5yr).
- `tests/test_edge_cases.py` (18 tests) — zero balance, very large balance, multi-account totals, special characters and Unicode in names, fractional interest rate precision, high interest rate (no crash), projection point counts for all supported periods, delete-then-create flow, password and username boundary lengths.
- `pytest.ini` — sets `testpaths = tests` and `pythonpath = .` so `import app` resolves from the project root.
- `requirements-dev.txt` — test dependencies: `pytest>=9.0`, `httpx>=0.25`.

#### Fixed

- **Stale balance returned on simultaneous inserts** — `ORDER BY recorded_at DESC LIMIT 1` in `list_accounts`, `get_summary`, and `get_projections` had no tiebreaker, causing non-deterministic results when two balance entries shared the same timestamp (reproducible in fast test runs, possible in production if two updates arrived within the same second). Fixed by adding `id DESC` as a secondary sort key: `ORDER BY recorded_at DESC, id DESC LIMIT 1`.

---

## [0.3.0] — 2026-05-17

### Documentation

#### Added

- `README.md` — comprehensive technical reference covering:
  - Requirements table mapping each original requirement (R1–R11) to its implementation.
  - Architecture overview with an ASCII request-path diagram and tech-stack rationale.
  - Annotated file-structure tree.
  - Full database schema with column-level documentation for all four tables and an explanation of the `user_id` migration strategy.
  - API reference for all routes including request / response shapes and the compound-interest projection formula.
  - Authentication system deep-dive: PBKDF2-SHA256 hashing parameters, session token entropy, cookie security flags, and logout invalidation behaviour.
  - Frontend section covering the login page flow, dashboard boot sequence, chart rendering approach (date de-duplication, forward-fill for step charts), and modal state machine.
  - Build and run instructions including `nohup` and systemd service examples.
  - Network access guidance: finding the VM's IP, firewall rules, HTTPS recommendation.
  - Testing section: complete set of curl-reproducible smoke tests with expected outputs, grouped by auth, isolation, data flow, and static assets.
  - Security notes distinguishing what is protected (parameterised queries, timing-safe comparison, HttpOnly cookies, ownership checks at the DB layer, HTML escaping) from what is not (no rate limiting, no HTTPS, no session purge).

---

## [0.2.0] — 2026-05-17

### Authentication

#### Added

**Backend**
- `users` table — `username` (case-insensitive unique via `COLLATE NOCASE`), `password_hash`, `created_at`.
- `sessions` table — 64-character hex token (32 random bytes, 256-bit entropy), `user_id` FK, `expires_at`; cascade-deleted when the user is removed.
- Schema migration — on startup `init()` checks `PRAGMA table_info(accounts)` and adds a `user_id` column via `ALTER TABLE` if absent, making the upgrade from the pre-auth schema non-destructive. Existing rows with `user_id = NULL` are not visible to any authenticated user.
- `hash_password` — PBKDF2-SHA256 with a 32-hex-character random salt and 260 000 iterations using only Python standard-library `hashlib` and `secrets`.
- `verify_password` — timing-safe comparison via `secrets.compare_digest`.
- `make_session` — generates a token, stores it with an expiry 30 days from now.
- `session_uid` — validates a token against the database and checks expiry.
- `require_auth` FastAPI dependency — reads the `piledger_session` cookie and raises `HTTP 401` if missing or expired; injects `user_id` into all protected routes.
- `POST /api/auth/register` — validates minimum lengths (username ≥ 2 chars, password ≥ 8 chars), returns `409` on duplicate username.
- `POST /api/auth/login` — verifies credentials, sets an `HttpOnly; SameSite=Lax; Max-Age=2592000` session cookie.
- `POST /api/auth/logout` — deletes the session row from the database and clears the cookie; idempotent (safe to call without a session).
- `GET /api/auth/me` — returns `{id, username}` for the current session.
- All account, balance, summary, history, and projection routes now require authentication and filter all queries by `user_id`, preventing any cross-user data access.
- `GET /` now redirects to `/login` (HTTP 302) when no valid session cookie is present.

**Frontend**
- `static/login.html` — standalone login / register page using the shared `style.css`. Tabbed interface (Sign in / Register) with inline error messages and `role="alert"` for accessibility. Auto-logs in after successful registration so users do not need to sign in manually.
- Username and "Sign out" button added to the dashboard header.
- `apiFetch` helper updated to redirect to `/login` on any `HTTP 401` response, so any expired or missing session across any API call is handled transparently.
- `logout()` function posts to `/api/auth/logout` then navigates to `/login`.
- Dashboard loads the current username from `/api/auth/me` on boot and displays it in the header.

---

## [0.1.0] — 2026-05-17

### Initial Release

#### Added

**Backend (`app.py`)**
- FastAPI application served by Uvicorn, binding to `0.0.0.0` for LAN access.
- SQLite database (`piledger.db`) auto-created on first run via `init()` using `CREATE TABLE IF NOT EXISTS`.
- `accounts` table — `name`, `type` (`current` / `savings`), `interest_rate`, `color`, `created_at`.
- `balance_history` table — immutable log of balance snapshots: `account_id`, `balance`, `notes`, `recorded_at`; cascade-deleted when the parent account is removed.
- `GET /api/accounts` — lists all accounts joined with their latest balance entry.
- `POST /api/accounts` — creates a current or savings account with optional colour and interest rate.
- `PUT /api/accounts/{id}` — updates name, interest rate, or colour.
- `DELETE /api/accounts/{id}` — removes account and all its balance history via cascade.
- `POST /api/accounts/{id}/balance` — appends a balance snapshot; accepts an optional `recorded_at` ISO timestamp for back-dating.
- `GET /api/accounts/{id}/history?days=N` — returns balance history for a rolling window.
- `GET /api/summary` — returns `total`, `total_current`, `total_savings`, `account_count`.
- `GET /api/history/all?days=N` — returns balance history for all accounts in the window, used to populate the history chart.
- `GET /api/projections?months=N` — compound-interest projections for all savings accounts using monthly compounding: `A = P × (1 + r/12)^m`. Returns pre-computed 1yr / 2yr / 5yr milestones plus a full `points[]` array.
- `GET /` — serves `static/index.html`.
- Static files mounted at `/static/`.

**Frontend**
- `static/index.html` — single-page application shell with four modals: Add Account, Update Balance, Edit Account, Confirm Delete.
- `static/style.css` — CSS custom-property–based design system; card layout with colour-coded account borders; responsive grid collapsing to single column on mobile.
- `static/app.js` — vanilla JavaScript with no framework. State held in a plain object. All API calls go through a central `apiFetch` wrapper. Charts managed via Chart.js 4.4 (CDN):
  - *Balance History* — stepped line chart per account. Dates are de-duplicated across all accounts and sorted; missing entries for a given account are forward-filled from the previous known balance, accurately representing a balance that stays constant until updated.
  - *Portfolio Distribution* — doughnut chart with each account as a segment.
  - *Savings Projections* — smooth line chart per savings account showing compound growth; per-account stat cards with 1yr / 2yr / 5yr values and interest earned. Section hidden when no savings accounts exist.
- Add Account modal records an optional opening balance in the same request flow.
- Update Balance modal pre-fills the current balance.
- Edit Account modal shows the interest rate field only for savings accounts.
- ESC key and overlay click close any open modal; Enter submits the active modal form.
- Accounts sorted by creation date; account cards show AER % for savings accounts.

**Infrastructure**
- `requirements.txt` — `fastapi>=0.104.0`, `uvicorn[standard]>=0.24.0`.
- `start.sh` — wraps `uvicorn app:app --host 0.0.0.0 --port 8080` for convenience.
- Python virtual environment created at `venv/`.
