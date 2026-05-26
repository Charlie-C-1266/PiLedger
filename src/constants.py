"""Module-level constants, type aliases, and bounds shared across PiLedger."""

import os
from typing import Literal


# Application version. Returned by `GET /healthz` so uptime monitors and
# operators can confirm what's actually running without `ssh && git log`.
# Bump in lock-step with the CHANGELOG header on every release.
VERSION = "0.27.1"


# ─── Paths / cookies ──────────────────────────────────────────────────────────

DB: str = os.environ.get(
    "PILEDGER_DB",
    # Source lives in src/; the default DB file lives at the project root
    # so existing dev databases keep working after the src/ restructure.
    # Resolve via one parent traversal from this module's location.
    os.path.normpath(os.path.join(os.path.dirname(__file__), os.pardir, "piledger.db")),
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

AccountType = Literal["current", "savings", "loan"]
Frequency = Literal["weekly", "monthly", "quarterly", "annually"]

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
    "credit_card",
    "mortgage",
    "student_loan",
    "car_finance",
    "overdraft",
    "bnpl",
]

# Which sub-types each parent type accepts. Used by the API to reject
# nonsense combos like type=current, subtype=mortgage.
# Per-user UI preferences. Olive is the default colour palette; users can pick
# an alternative from the Settings modal. Adding a new theme = adding a value
# here plus matching CSS variables in static/style.css.
Theme = Literal[
    "olive",
    "indigo",
    "slate",
    "rose",
    "emerald",
    "teal",
    "sky",
    "amber",
    "crimson",
    "violet",
]
DEFAULT_THEME: Theme = "olive"

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
            "credit_card",
            "mortgage",
            "student_loan",
            "car_finance",
            "overdraft",
            "bnpl",
        }
    ),
}

FREQ_TO_MONTHLY: dict[Frequency, float] = {
    "weekly": 52 / 12,
    "monthly": 1.0,
    "quarterly": 1 / 3,
    "annually": 1 / 12,
}


# ─── API bounds ───────────────────────────────────────────────────────────────
# Money is bounded so float→cents conversion stays well within int64 head-room
# and the frontend never has to render absurdly large strings.

MAX_MONEY = 1_000_000_000_000.0  # ±1 trillion dollars
MAX_RATE = 1_000.0  # % per annum
MAX_DAYS = 36_500  # ~100 years of history
MAX_MONTHS = 1_200  # 100 years of projection
