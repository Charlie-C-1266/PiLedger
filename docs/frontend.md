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

The SPA is mounted from `static/dist/index.html` (the Vite production build). React Router handles client-side navigation between six screens:

| Route | Component | Purpose |
|---|---|---|
| `/overview` | `Overview` | Net-worth chart (with a "Savings projections" modal), account card stack, recent transactions, goals progress rings, asset distribution donut |
| `/accounts` | `Accounts` | Full account list with card stack (fan / cascade / wave / grid variants), a per-account balance-history chart with a 7D/30D/90D/1Y range picker, assets-vs-debts sections, account type filter, and a list / by-institution view toggle |
| `/transactions` | `Transactions` | Paginated transaction browser with full-text search, account filter, category chips, date/amount sort |
| `/budget` | `Budget` | Zero-based envelope budget: income lines, envelope groups with live spent-vs-budgeted sliders, "left to budget" hero, period toggle (monthly/weekly/yearly), safe-to-spend, allocation donut, and a budget-vs-actual trend |
| `/goals` | `Goals` | Savings goals grid with target progress, monthly contribution, and ETA |
| `/settings` | `Settings` | Theme, dark mode, custom transaction categories, exchange-rate editor, documentation link, password change, account deletion |

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
| `useRates()` | `GET /api/rates` | default |
| `useSummary()` | `GET /api/summary` | 30 s |
| `useProjections(months)` | `GET /api/projections` | default |
| `useNetWorthSeries(range)` | `GET /api/history/networth` | 30 s |
| `useAllHistory(range)` | `GET /api/history/all` | default |
| `useMe()` | `GET /api/auth/me` | Infinity |

Any hook receiving a `401` response redirects to `/login` immediately.

The Budget screen's sliders and steppers edit through `useBudgetEdit`: it patches the cached `["budget"]` payload synchronously so every derived figure (group totals, the hero, the donut, safe-to-spend) re-renders instantly, then debounces the matching `PUT` (~400 ms, like the Goals contribution slider) and reconciles with the server on success.

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
| Savings projections | Overview (modal) | Multi-line (`AccountProjectionsModal`) | `GET /api/projections?months=` — compound-interest growth per savings account |

The `RangePills` component renders the 7D / 30D / 90D / 1Y segmented control used by the net-worth chart and the Accounts balance-history chart; the Budget screen has its own monthly/weekly/yearly `PeriodToggle`.

## Modals

Write operations open modal dialogs. All modals close on overlay click or `Escape`.

| Modal | Trigger | Operation |
|---|---|---|
| Add Account | "+ Add" menu | Creates an account (name, institution, type, currency, colour); optionally records an opening balance. Currency defaults to the user's base currency. |
| Update Balance / Edit Account | Click account card | Records a new `balance_history` row and/or updates the account's colour, institution, and set-aside/closed flags. |
| Add / Edit Transaction | "+ Add" menu or row edit button | Creates or updates a transaction record; balance is adjusted automatically. |
| Add / Edit Goal | "+ Add" menu or goal card edit | Creates or updates a savings goal. |
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
and monogram live in `lib/institutions.ts`, and `InstitutionMark` draws them as a
brand-coloured badge. The marks are monograms rather than real logos — logos are
trademarked artwork, and a self-hosted app has no business redistributing them
or reaching out to a CDN to fetch them at render time.

`resolveInstitution(account)` is the single entry point: it returns the
catalogue entry for a known slug, derives one (initials, hash-picked colour) from
the free-text name for the `other` slug, and returns `null` when no provider is
recorded. Its `key` field is what the Accounts screen groups by, so two
spellings of one custom name collapse into a single group.

Adding an institution means adding the slug to the `InstitutionSlug` literal in
`constants.py` *and* an entry to `INSTITUTIONS` here —
`tests/test_institution_frontend_parity.py` fails if only one side moves.
