# Frontend

The frontend is a React 19 single-page application built with Vite and TypeScript. It talks to the FastAPI backend exclusively over the JSON API; all writes go through the API and all state is managed with TanStack Query (server cache) and local React state (UI).

## Tech stack

| Layer | Technology |
|---|---|
| Framework | React 19 (with hooks) |
| Language | TypeScript |
| Bundler | Vite |
| Data fetching | TanStack Query v5 |
| Charts | Recharts |
| Routing | React Router v7 |

## Login page (`login.html`)

A self-contained page with no external JavaScript dependencies. It contains:

- A segmented tab control to switch between **Sign in** and **Register** forms.
- Inline validation (password confirmation match, minimum length).
- Inline error display using `role="alert"` on error elements.
- After a successful registration the page automatically posts a login request and redirects to `/`, so the user never has to sign in manually after creating their account.

## Guide page (`guide.html`)

A standalone, publicly accessible documentation page served at `/guide` (outside the SPA and the session gate). It renders Markdown to HTML in the browser using the vendored `marked.js` (`static/vendor/marked.min.js`) and shares the app's theme via `theme-bootstrap.js`.

## SPA screens

The SPA is mounted from `static/dist/index.html` (the Vite production build). React Router handles client-side navigation between seven screens and the per-account page:

| Route | Component | Purpose |
|---|---|---|
| `/overview` | `Overview` | Net-worth chart (with a "Savings projections" modal), account card stack, recent transactions, goals progress rings, asset distribution donut |
| `/accounts` | `Accounts` | Full account list with card stack (fan / cascade / wave / grid variants), a per-account balance-history chart with a 7D/30D/90D/1Y range picker, assets-vs-debts sections, account type filter, and a list / by-institution view toggle. Each tile links to its account's page. |
| `/accounts/:id` | `AccountPage` | One account: header (provider mark, name, net-worth chip, Edit / Transfer / Add transaction), current balance with its 30-day change and share of net worth, the projected balance (horizon tiles + projection chart), the Upcoming card, account details, and the latest transactions. Also reached from a transaction's account name and from search. Unknown ids show "Account not found". See [Account page](#account-page). |
| `/transactions` | `Transactions` | Paginated transaction browser with full-text search, account filter, category chips, date/amount sort. `?q=` seeds the search and `?account=<id>` the account filter. |
| `/budget` | `Budget` | Zero-based envelope budget: income lines, envelope groups with live spent-vs-budgeted sliders, "left to budget" hero, period toggle (monthly/weekly/yearly), safe-to-spend, allocation donut, and a budget-vs-actual trend |
| `/goals` | `Goals` | Savings goals grid with target progress, monthly contribution, and ETA |
| `/scheduled` | `Subscriptions` | Scheduled payments, income and transfers: a List / Calendar toggle, each item's Auto badge and next due date, and the calendar's posted (tick) and skipped (hollow ring) markers. The component keeps its old name; `/subscriptions` redirects here. |
| `/settings` | `Settings` | Theme, dark mode, custom transaction categories, exchange-rate editor, documentation link, password change, account deletion |

All routes require a valid session. The server returns `302 → /login` for unauthenticated requests; the client also redirects on receiving `401` from any API call.

## Shell and navigation

`Shell.tsx` wraps every screen and renders:

- **Sidebar** — navigation rail with links to the seven screens, the signed-in username at the bottom, and a Sign Out button. Uses `useMe()` to resolve the username from `GET /api/auth/me` on load.
- **Header** — top bar with the current date, a greeting, a global search input, a dark-mode toggle, and an **+ Add** dropdown menu.

The sidebar collapses to a bottom tab strip (`TabStrip.tsx`) on narrow viewports.

## Data fetching

All API calls go through typed wrappers in `src/api/client.ts`. TanStack Query hooks in `src/hooks/` cache the responses and handle background refetching:

| Hook | Endpoint | Stale time |
|---|---|---|
| `useAccounts()` | `GET /api/accounts` | 30 s |
| `useTransactions(filters)` | `GET /api/transactions` | 30 s |
| `useGoals()` | `GET /api/goals` | 30 s |
| `useBudget()` | `GET /api/budget` | default |
| `useRates()` | `GET /api/rates` | default |
| `useSummary()` | `GET /api/summary` | 30 s |
| `useProjections(months)` | `GET /api/projections` | default |
| `useNetWorthSeries(range)` | `GET /api/history/networth` | 30 s |
| `useAllHistory(range)` | `GET /api/history/all` | default |
| `useAccountActivity(id, days)` | `GET /api/accounts/{aid}/activity` | default |
| `useAccountHistory(id, range, {opening})` | `GET /api/accounts/{aid}/history` | default |
| `useAccountProjection(id)` | `GET /api/accounts/{aid}/projection` | default |
| `useSubscriptions()` | `GET /api/subscriptions` | default |
| `useOccurrences(from, to)` | `GET /api/subscriptions/occurrences` | default |
| `useMe()` | `GET /api/auth/me` | Infinity |

Any hook receiving a `401` response redirects to `/login` immediately.

The Budget screen's sliders and steppers edit through `useBudgetEdit`: it patches the cached `["budget"]` payload synchronously so every derived figure (group totals, the hero, the donut, safe-to-spend) re-renders instantly, then debounces the matching `PUT` (~400 ms, like the Goals contribution slider) and reconciles with the server on success.

## Account page

`AccountPage` (`/accounts/:id`) finds the account in `useAccounts()` and lays it out in two columns that stack on narrower screens: the balance card and recent transactions on the left, and a side column with the account's tile, its details and the Upcoming card. The pure rules behind it live beside the screen in `screens/account/` so each can be unit-tested without rendering: `accountModel.ts` (rate and date wording, the share-of-net-worth line, FX to base) and `projectionModel.ts` (chart rows and axes, horizon wording, the low-point note, the Upcoming window). The server does all the date and interest maths; the client only slices and formats its answer.

- **Balance card** — the current balance, a `DeltaPill` with the change from `GET /api/accounts/{aid}/activity`, the share-of-net-worth line, the "Update balance" pill (`UpdateBalanceModal`), and `ProjectionPanel`.
- **`ProjectionPanel`** — one 12-month projection and one 90-day history (with `opening=true`) serve every horizon. `HorizonTiles` shows the 1/3/6/12-month balances and doubles as the chart's range picker: a radio group with a roving tabindex, so the arrow keys move the selection. `ProjectionChart` draws the actual balance up to today and the projection after it, with a "Today" marker, the low point (asset accounts only), a crosshair driven by pointer or arrow keys, and a visually hidden table of month-end balances. Under it, the note reads "Goes overdrawn on …" or gives the lowest point. Closed accounts request neither query.
- **`UpcomingCard`** — the projection's events from today to 30 days ahead (first seven shown), each as an `UpcomingRow` with the balance after it. A scheduled row opens `UpcomingActions`; `useOccurrenceActions` runs Post now / Skip, refreshes the affected caches, and confirms with an Undo toast. Projected interest rows aren't actionable. Hidden for closed accounts.
- **Recent transactions** — the latest seven (`TxnRow`), with "View all" linking to `/transactions?account=<id>`.
- **Account details** — a `DetailList` of label–value pairs.

Shared components that came with it:

| Component | Purpose |
|---|---|
| `NetWorthChip` | "Counts toward net worth" / "Set aside" / "Closed" chip beside the account name. Reports the setting; changing it lives in Edit account. |
| `DetailList` | Read-only label–value pairs (`<dl>`), with an optional mark before a value and a note under it. |
| `DeltaPill` | A signed change in a coloured pill, e.g. "+£120.00" followed by "vs 30 days ago". Also used by the Overview net-worth hero. |
| `TextLink` | A quiet text link with a chevron, for "View all" and "Manage" in card headers. |
| `HorizonTiles`, `ProjectionChart`, `UpcomingRow`, `UpcomingActions` | The projection and Upcoming pieces above (`components/accounts/`, `components/charts/`). |

`TxnRow` marks a transaction posted from a schedule (`subscription_id` set) with a repeat icon, and its account name is a link to that account's page.

## Toasts

`ToastProvider` shows short confirmations in the corner: `toast.success(message)` in green and `toast.error(message)` in red (the error stays a little longer). Either can carry an action button, `{ action: { label, onClick } }`; clicking it dismisses the toast, and a toast with an action stays up longer so there's time to use it. The account page uses this for Undo after Post now and Skip.

## Cache invalidation

`useInvalidate()` is the single list of which query caches each kind of change touches. A balance or transaction change refreshes the account's activity, history and projection along with the net-worth views; a scheduled-item change refreshes the Scheduled list and calendar *and* carries the whole transaction ripple, because items now create transactions.

## Charts

Line/area charts use **Recharts**; the donut and the horizontal/trend bars are hand-rolled SVG and CSS components in `src/components/charts/` (`Donut`, `HBar`) and the Budget screen.

| Chart | Screen | Type | Data source |
|---|---|---|---|
| Net worth | Overview | Area line | `GET /api/history/networth?range=7D\|30D\|90D\|1Y` |
| Account balances | Accounts | Multi-line step (`AccountHistoryChart`) | `GET /api/history/all?days=` — one line per account, not currency-converted |
| Distribution | Overview | Donut (SVG) | Account list (in memory). Loans and credit excluded — shows asset distribution only. |
| Allocation donut | Budget | Donut (SVG) | Group totals from `GET /api/budget` |
| Spent vs budgeted | Budget | Horizontal bar (`HBar`) | Per-envelope spent/budgeted from `GET /api/budget` |
| Budget vs actual | Budget | CSS-grid bars | 6-month `history` from `GET /api/budget` |
| Savings projections | Overview (modal) | Multi-line (`AccountProjectionsModal`) | `GET /api/projections?months=` — each savings account's projected balance by month |
| Projected balance | Account page | Area line, actual then projected (`ProjectionChart`) | `GET /api/accounts/{aid}/history?days=90&opening=true` for the actual part, `GET /api/accounts/{aid}/projection` for the rest |

The `RangePills` component renders the 7D / 30D / 90D / 1Y segmented control used by the net-worth chart and the Accounts balance-history chart; the Budget screen has its own monthly/weekly/yearly `PeriodToggle`.

## Modals

Write operations open modal dialogs. All modals close on overlay click or `Escape`.

| Modal | Trigger | Operation |
|---|---|---|
| Add Account | "+ Add" menu | Creates an account (name, institution, type, currency, colour); optionally records an opening balance. Currency defaults to the user's base currency. |
| Edit Account | Account page's Edit button | Records a new `balance_history` row (and, when it changes the balance, a Balance adjustment transaction) and/or updates the account's colour, institution, and set-aside/closed flags. |
| Update Balance | Account page's "Update balance" pill | Records a `balance_history` row with an optional earlier date and note; a changed balance also records a Balance adjustment transaction (refreshed via `useInvalidate().balanceRecorded`). |
| Transfer | "+ Add" menu or account page | Moves money between two same-currency accounts; from an account page it starts with that account as the source. |
| Add / Edit Transaction | "+ Add" menu or row edit button | Creates or updates a transaction record; balance is adjusted automatically. A Balance adjustment opens a read-only view instead: its note can be changed and it can be deleted, but not its amount or account. |
| Add / Edit Goal | "+ Add" menu or goal card edit | Creates or updates a savings goal. |
| Add / Edit Scheduled item | Scheduled screen, or "Edit schedule" on the account page | Creates or updates a scheduled payment, income or transfer (`AddSubscriptionModal`). The "Post automatically" switch starts on for a new item and is disabled, with the reason as its hint, until every account it posts to is chosen and open; the request always sends `auto_post` explicitly. |
| Upcoming actions | A scheduled row in the account page's Upcoming card | Post now, Skip this one, or Edit schedule for that occurrence (`UpcomingActions`). |
| Add / Edit Group | Budget screen | Creates, edits, or deletes an envelope group (name, colour, fixed/flexible). |
| Add / Edit Envelope | Budget screen | Creates, edits, or deletes an envelope (label, tracked category, group, monthly budget). |
| Confirm Delete | Within any edit modal | Two-step confirmation before any destructive action. |

## Theme system

`ThemeProvider.tsx` wraps the app and exposes a React context consumed by `useTheme()`. Preferences are stored client-side in `localStorage` (`pl-theme-mode`, `pl-theme-accent`) — per browser, not synced to the server — and applied by writing the `--pl-*` CSS custom properties (from `tokens.ts`) onto `:root`.

- **Accent colour** — five preset accents (`ACCENT_OPTIONS` in `tokens.ts`), chosen as colour swatches in Settings → Appearance.
- **Light / dark mode** — toggled from the header; the choice persists in `localStorage`.

## Privacy mode

The header's eye button (also mirrored in Settings → Appearance) masks every currency amount on screen, replacing the digits with `£****`. `PrivacyProvider.tsx` holds the flag, persisted per browser in `localStorage` (`pl-privacy`) like the theme.

Components never import `fmt` / `fmtShort` from `lib/currency` directly — they format through `useMoney()`, which returns either the real formatters or mask-producing ones, so flipping the switch re-renders every amount at once. `usePrivacy()` deliberately falls back to "showing" outside a provider, which keeps a component (or a unit test) rendered on its own working.

The mask is a fixed width and carries no sign: tracking the digit count or the `−` would leak the very thing it hides. Chart Y-axis ticks blank out entirely rather than repeating the mask at every gridline. Percentages, counts, and chart line shapes are left alone — they're relative, so they give no figure away.

## Build

```bash
cd frontend
npm ci
npm run build   # outputs to src/static/dist/
```

The FastAPI app serves `src/static/dist/index.html` for all SPA routes, and serves the rest of `src/static/` under the `/static/` path prefix.

## Institution marks

`accounts.institution` stores a catalogue slug; the display name, brand colour
and monogram live in `lib/institutions.ts`. The marks are monograms rather than
real logos — logos are trademarked artwork, and a self-hosted app has no business
redistributing them or reaching out to a CDN to fetch them at render time.

Two components draw them, sharing `markFontSize` / `markForeground` so the
monogram is sized and inked the same way at both scales:

- `InstitutionMark` — a small rounded badge, used in the Accounts screen's
  by-institution group headings.
- `InstitutionEmblem` — the account card's own artwork: brand-coloured rings
  bleeding off the top-right corner around a solid brand disc, standing in for
  the plain white circles a card shows when no provider is recorded. Each ring
  carries a faint white understroke, because card colours are user-chosen and
  often *are* the brand colour — a Chase-blue ring on a Chase-blue card would
  otherwise vanish. The card's "Closed" / "Set aside" badge sits at the bottom
  right so it never collides with the emblem.

`resolveInstitution(account)` is the single entry point: it returns the
catalogue entry for a known slug, derives one (initials, hash-picked colour) from
the free-text name for the `other` slug, and returns `null` when no provider is
recorded. Its `key` field is what the Accounts screen groups by, so two
spellings of one custom name collapse into a single group.

Adding an institution means adding the slug to the `InstitutionSlug` literal in
`constants.py` *and* an entry to `INSTITUTIONS` here —
`tests/test_institution_frontend_parity.py` fails if only one side moves.
