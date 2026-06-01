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
| Routing | React Router v6 |

## Login page (`login.html`)

A self-contained page with no external JavaScript dependencies. It contains:

- A segmented tab control to switch between **Sign in** and **Register** forms.
- Inline validation (password confirmation match, minimum length).
- Inline error display using `role="alert"` on error elements.
- After a successful registration the page automatically posts a login request and redirects to `/`, so the user never has to sign in manually after creating their account.

## SPA screens

The SPA is mounted from `static/dist/index.html` (the Vite production build). React Router handles client-side navigation between six screens:

| Route | Component | Purpose |
|---|---|---|
| `/overview` | `Overview` | Net-worth chart, account card stack, recent transactions, goals progress rings, asset distribution donut |
| `/accounts` | `Accounts` | Full account list with card stack (fan / cascade / wave / grid variants), assets-vs-debts sections, account type filter |
| `/transactions` | `Transactions` | Paginated transaction browser with full-text search, account filter, category chips, date/amount sort |
| `/budget` | `Budget` | Zero-based envelope budget: income lines, envelope groups with live spent-vs-budgeted sliders, "left to budget" hero, period toggle (monthly/weekly/yearly), safe-to-spend, allocation donut, and a budget-vs-actual trend |
| `/goals` | `Goals` | Savings goals grid with target progress, monthly contribution, and ETA |
| `/settings` | `Settings` | Theme, dark mode, base currency, exchange rates, password change, account deletion |

All routes require a valid session. The server returns `302 → /login` for unauthenticated requests; the client also redirects on receiving `401` from any API call.

## Shell and navigation

`Shell.tsx` wraps every screen and renders:

- **Sidebar** — navigation rail with links to the six screens, the signed-in username at the bottom, and a Sign Out button. Uses `useMe()` to resolve the username from `GET /api/auth/me` on load.
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
| `useSummary()` | `GET /api/summary` | 30 s |
| `useNetWorthSeries(range)` | `GET /api/history/networth` | 30 s |
| `useMe()` | `GET /api/auth/me` | Infinity |

Any hook receiving a `401` response redirects to `/login` immediately.

The Budget screen's sliders and steppers edit through `useBudgetEdit`: it patches the cached `["budget"]` payload synchronously so every derived figure (group totals, the hero, the donut, safe-to-spend) re-renders instantly, then debounces the matching `PUT` (~400 ms, like the Goals contribution slider) and reconciles with the server on success.

## Charts

Line/area charts use **Recharts**; the donut and the horizontal/trend bars are hand-rolled SVG and CSS components in `src/components/charts/` (`Donut`, `HBar`) and the Budget screen.

| Chart | Screen | Type | Data source |
|---|---|---|---|
| Net worth | Overview | Area line | `GET /api/history/networth?range=7D\|30D\|90D\|1Y` |
| Distribution | Overview | Donut (SVG) | Account list (in memory). Loans and credit excluded — shows asset distribution only. |
| Account balance | Accounts | Stepped line | `GET /api/accounts/{id}/history` |
| Savings projection | Overview | Smooth line | `GET /api/projections` |
| Allocation donut | Budget | Donut (SVG) | Group totals from `GET /api/budget` |
| Spent vs budgeted | Budget | Horizontal bar (`HBar`) | Per-envelope spent/budgeted from `GET /api/budget` |
| Budget vs actual | Budget | CSS-grid bars | 6-month `history` from `GET /api/budget` |

The `RangePills` component renders the 7D / 30D / 90D / 1Y segmented control used by the net-worth chart; the Budget screen has its own monthly/weekly/yearly `PeriodToggle`.

## Modals

Write operations open modal dialogs. All modals close on overlay click or `Escape`.

| Modal | Trigger | Operation |
|---|---|---|
| Add Account | "+ Add" menu | Creates account; optionally records an opening balance. |
| Update Balance / Edit Colour | Click account card | Records a new `balance_history` row and/or updates the account colour. |
| Add / Edit Transaction | "+ Add" menu or row edit button | Creates or updates a transaction record; balance is adjusted automatically. |
| Add / Edit Goal | "+ Add" menu or goal card edit | Creates or updates a savings goal. |
| Add / Edit Group | Budget screen | Creates, edits, or deletes an envelope group (name, colour, fixed/flexible). |
| Add / Edit Envelope | Budget screen | Creates, edits, or deletes an envelope (label, tracked category, group, monthly budget). |
| Confirm Delete | Within any edit modal | Two-step confirmation before any destructive action. |

## Theme system

`ThemeProvider.tsx` wraps the app and exposes a React context consumed by `useTheme()`. It reads initial preferences from `GET /api/prefs` and persists changes via `PUT /api/prefs`.

- **Accent colour** — 10 named themes (`olive`, `emerald`, `teal`, `sky`, `indigo`, `violet`, `rose`, `crimson`, `amber`, `slate`). Mapped to CSS custom properties via `tokens.ts`.
- **Light / dark mode** — toggled from the header. A `theme-bootstrap.js` script runs before React mounts to apply the saved theme class, preventing a flash of unstyled content.

## Build

```bash
cd frontend
npm ci
npm run build   # outputs to src/static/dist/
```

The FastAPI app serves `src/static/dist/index.html` for all SPA routes, and serves the rest of `src/static/` under the `/static/` path prefix.
