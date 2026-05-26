# Frontend

## Login page (`login.html`)

A self-contained page with no external JavaScript dependencies. It contains:

- A segmented tab control to switch between **Sign in** and **Register** forms.
- Inline validation (password confirmation match, minimum length).
- Inline error display using `role="alert"` on error elements.
- After a successful registration the page automatically posts a login request and redirects to `/`, so the user never has to sign in manually after creating their account.

## Dashboard (`index.html` + `app.js`)

The dashboard is a single-page application with two views — **Overview** and **Budget Planner** — switched via a sticky nav tab inside the header. The header also shows the signed-in username, a Sign-out button, and a live **Net Worth** total.

On load `app.js` fires `loadAll()`, which makes three parallel requests for the Overview view:

```
GET /api/accounts
GET /api/summary
GET /api/auth/me
```

If any of these returns `401` the `apiFetch` helper immediately redirects to `/login` and returns a promise that never resolves, preventing any further rendering.

Once the initial data arrives, charts are loaded in a second parallel batch:

```
GET /api/history/all
GET /api/projections
```

The distribution chart is rendered synchronously from the account data already in memory.

The Budget Planner view is lazy-loaded the first time the user opens that tab. `loadBudgetView()` makes two parallel requests:

```
GET /api/budget
GET /api/budget/projection?months=<3|6|12>
```

### Summary cards (Overview)

Four cards across the top of the Overview view: **Total Savings**, **Current Accounts**, **Total Debt**, and **Accounts** (count). On viewports below 960px the grid collapses to 2x2; below 500px to a single column.

### Charts

All charts use **Chart.js 4.4** in category-scale mode (no date adapter required).

| Chart | View | Type | Data source | Notes |
|---|---|---|---|---|
| Balance History | Overview | Stepped line | `GET /api/history/all` | One dataset per account. Dates are de-duplicated across all accounts and sorted; missing values for a given account are forward-filled from the previous known balance, producing an accurate step representation of how balances changed over time. |
| Distribution | Overview | Doughnut | Account list (in memory) | Accounts with no recorded balance are excluded. **Loans are excluded** — this chart shows asset distribution, not liabilities. |
| Savings Projections | Overview | Smooth line | `GET /api/projections` | One dataset per savings account. The section is hidden entirely if no savings accounts exist. |
| Projected Balances | Budget | Multi-series line | `GET /api/budget/projection` | One dataset per account plus a bold dark **Net Worth** line layered on top. Loan lines are rendered with a dashed stroke so a downward trend reads as "debt being paid down" rather than an asset losing value. A faint dashed red zero-reference line is injected automatically if any account is projected to go negative. |

Chart instances are stored in the `charts` object (`history`, `distribution`, `projection`, `budget`) and explicitly destroyed before redrawing to prevent memory leaks when the user changes the time-window selector or budget period.

### Modals

Six modal dialogs handle all write operations:

| Modal | Trigger | Operation |
|---|---|---|
| Add Account | Header button | Creates account; optionally records an opening balance in the same flow. For loans, also accepts a "Minimum Monthly Payment" and creates a matching monthly budget item. |
| Update Balance | "Update Balance" on account card | Appends a new `balance_history` row; pre-fills the current balance |
| Edit Account | Pencil icon on account card | Updates name, interest rate, or colour. Interest-rate label switches between "AER (%)" (savings) and "APR (%)" (loan). |
| Confirm Delete Account | "Delete Account" inside Edit modal | Two-step confirmation before deleting |
| Budget Item (add / edit) | "+ Add" on toolbar or account card; pencil on an item row | Creates or edits a recurring item. Loan-aware: when the selected account is a loan, the direction toggle and frequency dropdown are hidden, and the amount field is relabeled "Minimum Monthly Payment". |
| Confirm Delete Budget Item | x icon on an item row | Two-step confirmation before removing |

Modals close on overlay click or `Escape`. The `Enter` key submits the active modal form (textareas excluded).

### State management

A single plain object (`state`) holds:

- **Overview**: `accounts`, `editingId`, `updatingId`, `deletingId`.
- **Budget**: `budgetPeriod` (3 / 6 / 12 months), `budgetItems`, `editingBudgetId` (`null` for add mode), `deletingBudgetId`, `biDir` (`'in'` or `'out'`).

After any write operation `loadAll()` (Overview) or `loadBudgetView()` (Budget) is called to refresh the relevant view.
