"""Module-level constants, type aliases, and bounds shared across PiLedger."""

import os
from typing import Literal


# Application version. Returned by `GET /healthz` so uptime monitors and
# operators can confirm what's actually running without `ssh && git log`.
# Bump in lock-step with the CHANGELOG header on every release.
VERSION = "3.2.0"


# ─── Paths / cookies ──────────────────────────────────────────────────────────

DB: str = os.environ.get(
    "PILEDGER_DB",
    # Source lives in src/; the default DB file lives at the project root
    # so existing dev databases keep working after the src/ restructure.
    # Resolve via one parent traversal from this module's location.
    os.path.normpath(os.path.join(os.path.dirname(__file__), os.pardir, "piledger.db")),
)
# How long a connection waits for a lock before giving up with "database is
# locked". Sync handlers run in Uvicorn's threadpool, so concurrent requests
# open concurrent connections and can briefly contend on a write; without this
# SQLite errors immediately rather than waiting the other writer out.
DB_BUSY_TIMEOUT_MS: int = int(os.environ.get("PILEDGER_DB_BUSY_TIMEOUT_MS", "5000"))

DOCS_DIR: str = os.path.normpath(
    os.path.join(os.path.dirname(__file__), os.pardir, "docs")
)
# Static assets ship inside the source tree (src/static). Resolved relative to
# this module rather than the process CWD so the app is invocable from any
# working directory (start.sh, the Docker entrypoint, IDE runners, and direct
# `uvicorn --app-dir src` all point at the same files). Shared by the ops,
# pages and auth routers plus the `/static` mount in app.py.
STATIC_DIR: str = os.path.join(os.path.dirname(__file__), "static")
DOC_SLUGS: frozenset[str] = frozenset(
    {
        "getting-started",
        "budgeting",
        "architecture",
        "authentication",
        "backups",
        "database",
        "deployment",
        "frontend",
        "api-reference",
        "security",
        "testing",
    }
)

SESSION_COOKIE = "piledger_session"
SESSION_DAYS = 30
# Set COOKIE_SECURE=true in production when serving over HTTPS
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "").lower() in ("1", "true", "yes")

# Rate limit applied to POST /api/auth/login. Keyed by the socket peer IP, so
# behind a reverse proxy every client shares one bucket — the proxy should do
# real per-client rate limiting (nginx `limit_req`, Caddy `rate_limit`) and
# this remains a defence-in-depth backstop. See README "Security Notes".
# Override via env, slowapi-style string ("N/period").
LOGIN_RATE_LIMIT = os.environ.get("PILEDGER_LOGIN_RATE_LIMIT", "5/minute")


# ─── Formats / patterns ───────────────────────────────────────────────────────

ISO_FMT = "%Y-%m-%dT%H:%M:%SZ"
HEX_COLOR_PATTERN = r"^#[0-9a-fA-F]{6}$"


# ─── Domain enums ─────────────────────────────────────────────────────────────

AccountType = Literal["current", "savings", "loan", "credit", "invest"]
RangeKey = Literal["7D", "30D", "90D", "1Y"]
RANGE_TO_DAYS: dict[str, int] = {"7D": 7, "30D": 30, "90D": 90, "1Y": 365}

# How often a subscription / standing order recurs. The fixed set is shared by
# the schema validator (schemas.Frequency) and the `subscriptions.frequency`
# CHECK constraint (built from FREQUENCIES in db.py) so the two cannot drift.
Frequency = Literal["weekly", "biweekly", "monthly", "quarterly", "annual"]
FREQUENCIES: tuple[str, ...] = (
    "weekly",
    "biweekly",
    "monthly",
    "quarterly",
    "annual",
)

# UK-market account sub-types. "general" is the catch-all for users who don't
# want to record this level of detail and is valid for every parent type.
# Storing the enum value (snake_case) keeps the API stable; the frontend owns
# the human-readable labels.
AccountSubtype = Literal[
    "general",
    # Current
    "standard",
    "joint",
    "student",
    "premier",
    "basic",
    "business",
    # Savings
    "cash_isa",
    "stocks_shares_isa",
    "lifetime_isa",
    "junior_isa",
    "regular_saver",
    "easy_access",
    "fixed_term_bond",
    "notice_account",
    "premium_bonds",
    "sipp",
    "workplace_pension",
    # Loan
    "bank_loan",
    "mortgage",
    "student_loan",
    "car_finance",
    "overdraft",
    "bnpl",
    # Credit
    "credit_card",
    "store_card",
    "charge_card",
    # Invest
    "trading_account",
    "crypto",
]

# Supported currencies. Curated shortlist — adding a new one means appending
# here plus listing the symbol in CURRENCY_INFO below and the label in the
# frontend CURRENCIES table.
Currency = Literal[
    "GBP",
    "USD",
    "EUR",
    "JPY",
    "CAD",
    "AUD",
    "CHF",
    "NZD",
    "SEK",
    "NOK",
]
DEFAULT_CURRENCY: Currency = "GBP"
SUPPORTED_CURRENCIES: frozenset[str] = frozenset(
    {
        "GBP",
        "USD",
        "EUR",
        "JPY",
        "CAD",
        "AUD",
        "CHF",
        "NZD",
        "SEK",
        "NOK",
    }
)

# Display metadata. `decimals` is what the frontend uses to round; the DB
# still stores everything as integer 100ths of the major unit (see db.py)
# regardless of currency precision, which keeps the storage model uniform.
CURRENCY_INFO: dict[str, dict[str, object]] = {
    "GBP": {"symbol": "£", "name": "British Pound", "decimals": 2},
    "USD": {"symbol": "$", "name": "US Dollar", "decimals": 2},
    "EUR": {"symbol": "€", "name": "Euro", "decimals": 2},
    "JPY": {"symbol": "¥", "name": "Japanese Yen", "decimals": 0},
    "CAD": {"symbol": "C$", "name": "Canadian Dollar", "decimals": 2},
    "AUD": {"symbol": "A$", "name": "Australian Dollar", "decimals": 2},
    "CHF": {"symbol": "Fr.", "name": "Swiss Franc", "decimals": 2},
    "NZD": {"symbol": "NZ$", "name": "New Zealand Dollar", "decimals": 2},
    "SEK": {"symbol": "kr", "name": "Swedish Krona", "decimals": 2},
    "NOK": {"symbol": "kr", "name": "Norwegian Krone", "decimals": 2},
}

# Sanity bounds on an FX rate (X → base). Wide enough to cover any plausible
# pair (e.g. 1 USD ≈ 150 JPY, 1 JPY ≈ 0.0067 USD), tight enough that an
# accidental zero or absurd value is rejected.
MIN_RATE_FX = 0.000_001
MAX_RATE_FX = 1_000_000.0


# Which sub-types each parent type accepts. Used by the API to reject
# nonsense combos like type=current, subtype=mortgage.
SUBTYPES_BY_TYPE: dict[str, frozenset[str]] = {
    "current": frozenset(
        {
            "general",
            "standard",
            "joint",
            "student",
            "premier",
            "basic",
            "business",
        }
    ),
    "savings": frozenset(
        {
            "general",
            "cash_isa",
            "stocks_shares_isa",
            "lifetime_isa",
            "junior_isa",
            "regular_saver",
            "easy_access",
            "fixed_term_bond",
            "notice_account",
            "premium_bonds",
            "sipp",
            "workplace_pension",
        }
    ),
    "loan": frozenset(
        {
            "general",
            "bank_loan",
            "mortgage",
            "student_loan",
            "car_finance",
            "overdraft",
            "bnpl",
        }
    ),
    "credit": frozenset(
        {
            "general",
            "credit_card",
            "store_card",
            "charge_card",
        }
    ),
    "invest": frozenset(
        {
            "general",
            "trading_account",
            "crypto",
        }
    ),
}

# ─── API bounds ───────────────────────────────────────────────────────────────
# Money is bounded so float→cents conversion stays well within int64 head-room
# and the frontend never has to render absurdly large strings.

MAX_MONEY = 1_000_000_000_000.0  # ±1 trillion dollars
MAX_RATE = 1_000.0  # % per annum
MAX_DAYS = 36_500  # ~100 years of history
MAX_MONTHS = 1_200  # 100 years of projection

# ─── Transaction categories ───────────────────────────────────────────────────

# Built-in categories shown to every user. Custom categories are stored in
# user_categories and merged with these at the API layer.
DEFAULT_CATEGORIES: list[str] = [
    # Income
    "Salary",
    "Freelance",
    "Interest Earned",
    "Benefits",
    # Spending
    "Groceries",
    "Bills",
    "Dining",
    "Transport",
    "Shopping",
    "Entertainment",
    "Health",
    "Travel",
    "Clothing",
    "Subscriptions",
    "Pets",
    "Gifts",
    "Education",
    "Other",
]

# Maximum number of custom categories a single user may create.
MAX_CUSTOM_CATEGORIES = 50

# ─── CSV transaction import ───────────────────────────────────────────────────

# Generous enough for any real bank export, tight enough that an accidental
# multi-GB paste can't hang the parser.
MAX_IMPORT_ROWS = 5_000
MAX_IMPORT_CSV_CHARS = 5_000_000  # ~5MB of CSV text

# Small allowlisted set of date layouts rather than trusting an arbitrary
# strptime format string from the client.
ImportDateFormat = Literal["iso", "dmy", "mdy", "dmy_dash", "mdy_dash"]
IMPORT_DATE_FORMATS: dict[str, str] = {
    "iso": "%Y-%m-%d",
    "dmy": "%d/%m/%Y",
    "mdy": "%m/%d/%Y",
    "dmy_dash": "%d-%m-%Y",
    "mdy_dash": "%m-%d-%Y",
}
