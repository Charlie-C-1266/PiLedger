"""Pydantic request and response models for the PiLedger API."""

from datetime import datetime, timezone
from typing import Annotated, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from constants import (
    AccountSubtype,
    AccountType,
    Currency,
    Frequency,
    HEX_COLOR_PATTERN,
    ISO_FMT,
    MAX_MONEY,
    MAX_RATE,
    MAX_RATE_FX,
    MIN_RATE_FX,
    SUBTYPES_BY_TYPE,
    Theme,
)


# ─── Inbound schemas ──────────────────────────────────────────────────────────


class _In(BaseModel):
    """Inbound payload base — rejects unknown fields rather than silently dropping them."""

    model_config = ConfigDict(extra="forbid")


class LoginIn(_In):
    username: Annotated[str, Field(min_length=1, max_length=64)]
    password: Annotated[str, Field(min_length=1, max_length=256)]


class RegisterIn(_In):
    username: Annotated[str, Field(min_length=2, max_length=64)]
    password: Annotated[str, Field(min_length=8, max_length=256)]

    @field_validator("username")
    @classmethod
    def _strip_and_check_username(cls, v: str) -> str:
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

    @model_validator(mode="after")
    def _subtype_matches_type(self) -> "AccountIn":
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


class BalanceIn(_In):
    balance: Annotated[float, Field(ge=-MAX_MONEY, le=MAX_MONEY, allow_inf_nan=False)]
    notes: Optional[str] = Field(default=None, max_length=500)
    recorded_at: Optional[str] = None

    @field_validator("recorded_at")
    @classmethod
    def _normalise_recorded_at(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        # Canonical form first (cheap, matches our own emitted timestamps).
        try:
            datetime.strptime(v, ISO_FMT)
            return v
        except ValueError:
            pass
        # Fall back to a lenient ISO-8601 parse, then re-emit in canonical form.
        try:
            dt = datetime.fromisoformat(v.replace("Z", "+00:00"))
        except ValueError as e:
            raise ValueError("recorded_at must be an ISO-8601 datetime") from e
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).strftime(ISO_FMT)


class BudgetItemIn(_In):
    account_id: Annotated[int, Field(ge=1)]
    name: Annotated[str, Field(min_length=1, max_length=120)]
    amount: Annotated[float, Field(ge=-MAX_MONEY, le=MAX_MONEY, allow_inf_nan=False)]
    frequency: Frequency


class BudgetItemPatch(_In):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    amount: Optional[float] = Field(
        default=None, ge=-MAX_MONEY, le=MAX_MONEY, allow_inf_nan=False
    )
    frequency: Optional[Frequency] = None


class PrefsPatch(_In):
    """Partial update — only fields present are written."""

    theme: Optional[Theme] = None
    dark_mode: Optional[bool] = None
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
    theme: Theme
    dark_mode: bool
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
    created_at: str
    current_balance: Optional[float] = None
    last_updated: Optional[str] = None


class BalanceEntryOut(BaseModel):
    balance: float
    notes: Optional[str] = None
    recorded_at: str


class SummaryOut(BaseModel):
    total: float
    total_current: float
    total_savings: float
    total_loans: float
    account_count: int
    base_currency: Currency = "GBP"
    # Currencies present on the user's accounts that have no rate set (excluding
    # the base itself, which is implicitly 1.0). The frontend uses this to warn
    # that the net-worth total may be missing accounts.
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


class BudgetItemOut(BaseModel):
    id: int
    user_id: int
    account_id: int
    name: str
    amount: float
    frequency: Frequency
    created_at: str


# Projection responses include keys like "1yr" / "2yr" / "5yr" that aren't valid
# Python identifiers; FastAPI handles them fine via a plain dict return type.
