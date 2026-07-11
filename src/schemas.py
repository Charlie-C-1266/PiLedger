"""Pydantic request and response models for the PiLedger API."""

from datetime import datetime, timezone
from typing import Annotated, Optional

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

from constants import (
    AccountSubtype,
    AccountType,
    Currency,
    Frequency,
    HEX_COLOR_PATTERN,
    ImportDateFormat,
    ISO_FMT,
    MAX_IMPORT_CSV_CHARS,
    MAX_MONEY,
    MAX_RATE,
    MAX_RATE_FX,
    MIN_RATE_FX,
    SUBTYPES_BY_TYPE,
)


# ─── Inbound schemas ──────────────────────────────────────────────────────────


class _In(BaseModel):
    """Inbound payload base — rejects unknown fields rather than silently dropping them."""

    model_config = ConfigDict(extra="forbid")


def _to_canonical_utc(v: str) -> str:
    """Normalise an ISO-8601 datetime string to the canonical UTC ``ISO_FMT``.

    The canonical form is tried first as a cheap fast path (it matches our own
    emitted timestamps); other ISO-8601 inputs (a trailing ``Z``, a naive
    timestamp assumed UTC, or any offset) are parsed and re-emitted in canonical
    UTC, and anything unparseable raises.
    """
    try:
        datetime.strptime(v, ISO_FMT)
        return v
    except ValueError:
        pass
    try:
        dt = datetime.fromisoformat(v.replace("Z", "+00:00"))
    except ValueError as e:
        raise ValueError("must be an ISO-8601 datetime") from e
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime(ISO_FMT)


# A string field that is normalised to canonical UTC ``ISO_FMT`` on input. Wrap
# in ``Optional[...]`` for a field that may be omitted (the validator only runs
# on a present string, so None passes through untouched). Shared by every
# inbound timestamp so the four used to each carry a copy of this logic.
IsoDateTimeStr = Annotated[str, AfterValidator(_to_canonical_utc)]


def _to_iso_date(v: str) -> str:
    """Validate/normalise a date-only ``YYYY-MM-DD`` string. The date-only
    sibling of ``_to_canonical_utc`` — subscriptions track calendar days with no
    time-of-day, so they need this rather than the timestamp normaliser."""
    try:
        return datetime.strptime(v, "%Y-%m-%d").strftime("%Y-%m-%d")
    except ValueError as e:
        raise ValueError("must be an ISO-8601 date (YYYY-MM-DD)") from e


# A string field validated/normalised to a calendar date ``YYYY-MM-DD`` on input.
# Wrap in ``Optional[...]`` for a field that may be omitted or explicitly nulled.
IsoDateStr = Annotated[str, AfterValidator(_to_iso_date)]


class LoginIn(_In):
    username: Annotated[str, Field(min_length=1, max_length=64)]
    password: Annotated[str, Field(min_length=1, max_length=256)]


class RegisterIn(_In):
    username: Annotated[str, Field(min_length=2, max_length=64)]
    password: Annotated[str, Field(min_length=8, max_length=256)]

    @field_validator("username")
    @classmethod
    def _strip_and_check_username(cls, v: str) -> str:
        """Trim surrounding whitespace and reject names under 2 characters once
        trimmed (so a name of only spaces can't satisfy the length bound)."""
        v = v.strip()
        if len(v) < 2:
            raise ValueError("Username must be at least 2 characters after trimming")
        return v


class DeleteMeIn(_In):
    """Body for `DELETE /api/auth/me` — re-confirm the password before the
    cascade. Bounds match `LoginIn` so a stored-credential helper that
    works for login also works here."""

    password: Annotated[str, Field(min_length=1, max_length=256)]


class PasswordChangeIn(_In):
    """Body for `PUT /api/auth/password`. `current_password` accepts any
    non-empty string (it's compared against the stored hash; existing-password
    strength is not the new request's problem). `new_password` enforces the
    same lower bound `RegisterIn` uses so a change can never weaken a
    password below the registration policy."""

    current_password: Annotated[str, Field(min_length=1, max_length=256)]
    new_password: Annotated[str, Field(min_length=8, max_length=256)]


class AccountIn(_In):
    name: Annotated[str, Field(min_length=1, max_length=120)]
    type: AccountType
    subtype: AccountSubtype = "general"
    currency: Currency = "GBP"
    interest_rate: Annotated[float, Field(ge=0, le=MAX_RATE, allow_inf_nan=False)] = 0.0
    color: Annotated[str, Field(pattern=HEX_COLOR_PATTERN)] = "#6366f1"
    counts_to_net_worth: bool = True
    closed: bool = False

    @model_validator(mode="after")
    def _subtype_matches_type(self) -> "AccountIn":
        """Reject a subtype that isn't valid for the chosen account type, per
        ``SUBTYPES_BY_TYPE`` (e.g. a 'mortgage' subtype on a 'cash' account)."""
        if self.subtype not in SUBTYPES_BY_TYPE[self.type]:
            raise ValueError(
                f"subtype '{self.subtype}' is not valid for type '{self.type}'"
            )
        return self


class AccountPatch(_In):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    subtype: Optional[AccountSubtype] = None
    currency: Optional[Currency] = None
    interest_rate: Optional[float] = Field(
        default=None, ge=0, le=MAX_RATE, allow_inf_nan=False
    )
    color: Optional[str] = Field(default=None, pattern=HEX_COLOR_PATTERN)
    counts_to_net_worth: Optional[bool] = None
    closed: Optional[bool] = None


class BalanceIn(_In):
    balance: Annotated[float, Field(ge=-MAX_MONEY, le=MAX_MONEY, allow_inf_nan=False)]
    notes: Optional[str] = Field(default=None, max_length=500)
    recorded_at: Optional[IsoDateTimeStr] = None


class TransactionIn(_In):
    account_id: Annotated[int, Field(ge=1)]
    amount: Annotated[float, Field(ge=-MAX_MONEY, le=MAX_MONEY, allow_inf_nan=False)]
    occurred_at: Optional[IsoDateTimeStr] = None
    merchant: Annotated[str, Field(min_length=1, max_length=200)]
    category: Annotated[str, Field(max_length=100)] = ""
    note: Annotated[str, Field(max_length=500)] = ""


class TransactionPatch(_In):
    account_id: Optional[int] = Field(default=None, ge=1)
    amount: Optional[float] = Field(
        default=None, ge=-MAX_MONEY, le=MAX_MONEY, allow_inf_nan=False
    )
    occurred_at: Optional[IsoDateTimeStr] = None
    merchant: Optional[str] = Field(default=None, min_length=1, max_length=200)
    category: Optional[str] = Field(default=None, max_length=100)
    note: Optional[str] = Field(default=None, max_length=500)


class TransferIn(_In):
    """Move `amount` (a positive value) from one account to another. Becomes
    two linked transactions: -amount on the source, +amount on the destination."""

    from_account_id: Annotated[int, Field(ge=1)]
    to_account_id: Annotated[int, Field(ge=1)]
    amount: Annotated[float, Field(gt=0, le=MAX_MONEY, allow_inf_nan=False)]
    occurred_at: Optional[IsoDateTimeStr] = None
    note: Annotated[str, Field(max_length=500)] = ""


class ImportMappingIn(_In):
    """Maps required transaction fields to CSV column headers. Provide either
    `amount` (a single signed column) or both `debit` and `credit` (split
    columns), not neither or both."""

    date: Annotated[str, Field(min_length=1, max_length=200)]
    amount: Optional[str] = None
    debit: Optional[str] = None
    credit: Optional[str] = None
    merchant: Annotated[str, Field(min_length=1, max_length=200)]
    category: Optional[str] = None
    note: Optional[str] = None

    @model_validator(mode="after")
    def _check_amount_columns(self) -> "ImportMappingIn":
        """Reject a mapping that specifies both an amount scheme and a
        debit/credit scheme, or neither."""
        has_amount = self.amount is not None
        has_split = self.debit is not None and self.credit is not None
        if has_amount == has_split:
            raise ValueError(
                "provide either 'amount' or both 'debit' and 'credit', not neither or both"
            )
        return self


class ImportPreviewIn(_In):
    csv_text: Annotated[str, Field(min_length=1, max_length=MAX_IMPORT_CSV_CHARS)]


class ImportCommitIn(_In):
    csv_text: Annotated[str, Field(min_length=1, max_length=MAX_IMPORT_CSV_CHARS)]
    account_id: Annotated[int, Field(ge=1)]
    mapping: ImportMappingIn
    date_format: ImportDateFormat = "iso"


class GoalIn(_In):
    name: Annotated[str, Field(min_length=1, max_length=120)]
    target: Annotated[float, Field(gt=0, le=MAX_MONEY, allow_inf_nan=False)]
    saved: Annotated[float, Field(ge=0, le=MAX_MONEY, allow_inf_nan=False)] = 0.0
    monthly: Annotated[float, Field(ge=0, le=MAX_MONEY, allow_inf_nan=False)] = 0.0
    color: Annotated[str, Field(pattern=HEX_COLOR_PATTERN)] = "#0F766E"
    # Optional account to track: a linked goal's progress mirrors the account's
    # current balance instead of the manual `saved` value.
    account_id: Optional[int] = Field(default=None, ge=1)


class GoalPatch(_In):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    target: Optional[float] = Field(
        default=None, gt=0, le=MAX_MONEY, allow_inf_nan=False
    )
    saved: Optional[float] = Field(
        default=None, ge=0, le=MAX_MONEY, allow_inf_nan=False
    )
    monthly: Optional[float] = Field(
        default=None, ge=0, le=MAX_MONEY, allow_inf_nan=False
    )
    color: Optional[str] = Field(default=None, pattern=HEX_COLOR_PATTERN)
    # Set to an account id to link/track, or null to unlink. Uses exclude_unset
    # on update so an explicit null is honoured (unlink) while an absent field
    # is left unchanged.
    account_id: Optional[int] = Field(default=None, ge=1)


class SubscriptionIn(_In):
    name: Annotated[str, Field(min_length=1, max_length=120)]
    amount: Annotated[float, Field(gt=0, le=MAX_MONEY, allow_inf_nan=False)]
    category: Annotated[str, Field(max_length=100)] = ""
    # Optional account this payment is associated with — reminder-only in v1, so
    # it is purely a label (and the hook a future auto-posting feature builds on).
    account_id: Optional[int] = Field(default=None, ge=1)
    frequency: Frequency
    start_date: IsoDateStr  # the anchor occurrence
    end_date: Optional[IsoDateStr] = None  # null = ongoing
    # One of the frontend ACCENT_OPTIONS, or "" for the default accent. Plain
    # bounded string (the picker constrains the real choices, like Goals).
    color: Annotated[str, Field(max_length=32)] = ""
    notes: Annotated[str, Field(max_length=500)] = ""
    active: bool = True


class SubscriptionPatch(_In):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    amount: Optional[float] = Field(
        default=None, gt=0, le=MAX_MONEY, allow_inf_nan=False
    )
    category: Optional[str] = Field(default=None, max_length=100)
    # Set to an account id to link, or null to unlink. exclude_unset on update
    # honours an explicit null (unlink) while an omitted field is left unchanged.
    account_id: Optional[int] = Field(default=None, ge=1)
    frequency: Optional[Frequency] = None
    start_date: Optional[IsoDateStr] = None
    # null clears the end date (back to ongoing); omitted leaves it unchanged.
    end_date: Optional[IsoDateStr] = None
    color: Optional[str] = Field(default=None, max_length=32)
    notes: Optional[str] = Field(default=None, max_length=500)
    active: Optional[bool] = None


class BudgetIncomeIn(_In):
    label: Annotated[str, Field(min_length=1, max_length=120)]
    amount: Annotated[float, Field(ge=0, le=MAX_MONEY, allow_inf_nan=False)] = 0.0


class BudgetIncomePatch(_In):
    label: Optional[str] = Field(default=None, min_length=1, max_length=120)
    amount: Optional[float] = Field(
        default=None, ge=0, le=MAX_MONEY, allow_inf_nan=False
    )
    sort_order: Optional[int] = Field(default=None, ge=0)


class BudgetGroupIn(_In):
    name: Annotated[str, Field(min_length=1, max_length=120)]
    color: Annotated[str, Field(pattern=HEX_COLOR_PATTERN)] = "#0F766E"
    flexible: bool = False


class BudgetGroupPatch(_In):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    color: Optional[str] = Field(default=None, pattern=HEX_COLOR_PATTERN)
    flexible: Optional[bool] = None
    sort_order: Optional[int] = Field(default=None, ge=0)


class BudgetEnvelopeIn(_In):
    group_id: Annotated[int, Field(ge=1)]
    label: Annotated[str, Field(min_length=1, max_length=120)]
    category: Annotated[str, Field(min_length=1, max_length=100)]
    budgeted: Annotated[float, Field(ge=0, le=MAX_MONEY, allow_inf_nan=False)] = 0.0


class BudgetEnvelopePatch(_In):
    group_id: Optional[int] = Field(default=None, ge=1)
    label: Optional[str] = Field(default=None, min_length=1, max_length=120)
    category: Optional[str] = Field(default=None, min_length=1, max_length=100)
    budgeted: Optional[float] = Field(
        default=None, ge=0, le=MAX_MONEY, allow_inf_nan=False
    )
    sort_order: Optional[int] = Field(default=None, ge=0)


class PrefsPatch(_In):
    """Partial update — only fields present are written."""

    base_currency: Optional[Currency] = None


class RateIn(_In):
    """Single FX rate: `1 unit of currency = rate units of the user's base currency`."""

    currency: Currency
    rate: Annotated[float, Field(ge=MIN_RATE_FX, le=MAX_RATE_FX, allow_inf_nan=False)]


class RatesPut(_In):
    """Bulk replace of the user's manual rates table."""

    rates: list[RateIn] = Field(default_factory=list)


# ─── Outbound schemas ─────────────────────────────────────────────────────────


class UserOut(BaseModel):
    id: int
    username: str


class PrefsOut(BaseModel):
    base_currency: Currency = "GBP"


class RateOut(BaseModel):
    currency: Currency
    rate: float
    updated_at: Optional[str] = None


class RatesOut(BaseModel):
    base_currency: Currency
    rates: list[RateOut]


class RegisterOut(BaseModel):
    id: int
    username: str


class LoginOut(BaseModel):
    ok: bool
    username: str


class OkOut(BaseModel):
    ok: bool


class AccountOut(BaseModel):
    id: int
    user_id: int
    name: str
    type: AccountType
    subtype: AccountSubtype = "general"
    currency: Currency = "GBP"
    interest_rate: float
    color: str
    counts_to_net_worth: bool = True
    closed: bool = False
    created_at: str
    current_balance: Optional[float] = None
    last_updated: Optional[str] = None


class BalanceEntryOut(BaseModel):
    balance: float
    notes: Optional[str] = None
    recorded_at: str


class SummaryOut(BaseModel):
    # All figures below cover only Accounts flagged to count toward net worth
    # ("Accessible net worth", ADR-0003), except `set_aside` and
    # `total_net_worth`, which describe the excluded Accounts and the full
    # picture. `total` is the Accessible net-worth headline.
    total: float
    total_current: float
    total_savings: float
    total_loans: float
    total_credit: float = 0.0
    total_invest: float = 0.0
    assets: float = 0.0
    debts: float = 0.0
    savings_rate: float = 0.0
    set_aside: float = 0.0
    total_net_worth: float = 0.0
    account_count: int
    base_currency: Currency = "GBP"
    missing_rates: list[Currency] = Field(default_factory=list)


class HistoryPointOut(BaseModel):
    balance: float
    date: str


class HistoryAccountOut(BaseModel):
    id: int
    name: str
    color: str
    type: AccountType
    currency: Currency = "GBP"
    history: list[HistoryPointOut]


class TransactionOut(BaseModel):
    id: int
    user_id: int
    account_id: int
    amount: float
    occurred_at: str
    merchant: str
    category: str
    note: str
    transfer_id: Optional[str] = None
    created_at: str


class ImportPreviewOut(BaseModel):
    columns: list[str]
    sample_rows: list[list[str]]
    row_count: int
    suggested_mapping: dict[str, Optional[str]]


class ImportRowError(BaseModel):
    row: int
    message: str


class ImportCommitOut(BaseModel):
    imported: int
    skipped_duplicates: int
    errors: list[ImportRowError]


class GoalOut(BaseModel):
    id: int
    user_id: int
    name: str
    target: float
    saved: float
    monthly: float
    color: str
    account_id: Optional[int] = None
    account_name: Optional[str] = None
    interest_rate: Optional[float] = None
    created_at: str


class SubscriptionOut(BaseModel):
    id: int
    user_id: int
    name: str
    amount: float
    category: str
    account_id: Optional[int] = None
    account_name: Optional[str] = None
    frequency: Frequency
    start_date: str
    end_date: Optional[str] = None
    color: str
    notes: str
    active: bool
    # Computed on read (never stored): the next due date on or after today, or
    # null when the subscription is inactive or has elapsed past its end_date.
    next_due_date: Optional[str] = None
    created_at: str


class SubscriptionOccurrenceOut(BaseModel):
    """One expanded calendar hit, for the month-grid view."""

    date: str
    subscription_id: int
    name: str
    amount: float
    color: str


class NetWorthPointOut(BaseModel):
    date: str
    value: float


# ─── Envelope budget (read API) ───────────────────────────────────────────────
# Money is exposed as pounds (floats). `budgeted` and income `amount` are monthly
# figures; `spent` is the current month's actual, converted to the base currency.


class BudgetIncomeOut(BaseModel):
    id: int
    label: str
    amount: float
    sort_order: int


class BudgetEnvelopeOut(BaseModel):
    id: int
    group_id: int
    label: str
    category: str
    budgeted: float
    sort_order: int


class BudgetEnvelopeDetailOut(BudgetEnvelopeOut):
    """An envelope plus its live, current-month `spent` — used by
    `GET /api/budget`. The bare `BudgetEnvelopeOut` is what envelope CRUD
    returns."""

    spent: float


class BudgetGroupOut(BaseModel):
    id: int
    name: str
    color: str
    flexible: bool
    sort_order: int


class BudgetGroupDetailOut(BudgetGroupOut):
    """A group plus its envelopes (with live spent) — used by `GET /api/budget`.
    The bare `BudgetGroupOut` is what the group CRUD endpoints return."""

    envelopes: list[BudgetEnvelopeDetailOut]


class BudgetHistoryPoint(BaseModel):
    month: str  # "YYYY-MM"
    budgeted: float  # current total allocation (flat reference, not a snapshot)
    spent: float  # that month's spend across enveloped categories, in base currency


class BudgetOut(BaseModel):
    incomes: list[BudgetIncomeOut]
    groups: list[BudgetGroupDetailOut]
    history: list[BudgetHistoryPoint]
    base_currency: str
    missing_rates: list[str]


class CategoryIn(_In):
    name: Annotated[str, Field(min_length=1, max_length=100)]

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v: str) -> str:
        """Trim surrounding whitespace and reject a name that is blank once
        trimmed."""
        v = v.strip()
        if not v:
            raise ValueError("Category name must not be blank")
        return v


class CustomCategoryOut(BaseModel):
    id: int
    name: str


class CategoriesOut(BaseModel):
    defaults: list[str]
    custom: list[CustomCategoryOut]


# Projection responses include keys like "1yr" / "2yr" / "5yr" that aren't valid
# Python identifiers; FastAPI handles them fine via a plain dict return type.


class TokenCreate(_In):
    name: Annotated[str, Field(min_length=1, max_length=100)]


class TokenOut(BaseModel):
    id: int
    name: str
    created_at: str
    last_used_at: Optional[str] = None


class TokenCreatedOut(TokenOut):
    """`TokenOut` plus the raw token value, returned once on creation only —
    it is never recoverable afterwards since only its hash is stored."""

    token: str
