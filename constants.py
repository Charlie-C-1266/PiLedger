"""Module-level constants, type aliases, and bounds shared across FinDash."""
import os
from typing import Literal


# ─── Paths / cookies ──────────────────────────────────────────────────────────

DB: str = os.environ.get(
    "FINDASH_DB",
    os.path.join(os.path.dirname(__file__), "findash.db"),
)
SESSION_COOKIE = "findash_session"
SESSION_DAYS = 30
# Set COOKIE_SECURE=true in production when serving over HTTPS
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "").lower() in ("1", "true", "yes")


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
    "standard", "joint", "student", "premier", "basic", "business",
    # Savings
    "cash_isa", "stocks_shares_isa", "lifetime_isa", "junior_isa",
    "regular_saver", "easy_access", "fixed_term_bond", "notice_account",
    "premium_bonds", "sipp", "workplace_pension",
    # Loan
    "bank_loan", "credit_card", "mortgage", "student_loan", "car_finance",
    "overdraft", "bnpl",
]

# Which sub-types each parent type accepts. Used by the API to reject
# nonsense combos like type=current, subtype=mortgage.
# Per-user UI preferences. Olive is the default colour palette; users can pick
# an alternative from the Settings modal. Adding a new theme = adding a value
# here plus matching CSS variables in static/style.css.
Theme = Literal["olive", "indigo", "slate", "rose"]
DEFAULT_THEME: Theme = "olive"


SUBTYPES_BY_TYPE: dict[str, frozenset[str]] = {
    "current": frozenset({
        "general", "standard", "joint", "student", "premier", "basic", "business",
    }),
    "savings": frozenset({
        "general", "cash_isa", "stocks_shares_isa", "lifetime_isa", "junior_isa",
        "regular_saver", "easy_access", "fixed_term_bond", "notice_account",
        "premium_bonds", "sipp", "workplace_pension",
    }),
    "loan": frozenset({
        "general", "bank_loan", "credit_card", "mortgage", "student_loan",
        "car_finance", "overdraft", "bnpl",
    }),
}

FREQ_TO_MONTHLY: dict[Frequency, float] = {
    "weekly":    52 / 12,
    "monthly":   1.0,
    "quarterly": 1 / 3,
    "annually":  1 / 12,
}


# ─── API bounds ───────────────────────────────────────────────────────────────
# Money is bounded so float→cents conversion stays well within int64 head-room
# and the frontend never has to render absurdly large strings.

MAX_MONEY = 1_000_000_000_000.0   # ±1 trillion dollars
MAX_RATE  = 1_000.0               # % per annum
MAX_DAYS  = 36_500                # ~100 years of history
MAX_MONTHS = 1_200                # 100 years of projection
