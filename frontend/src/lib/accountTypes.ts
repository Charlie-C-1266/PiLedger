import type { AccountType } from "../types";

/**
 * Human labels for the account taxonomy. The keys mirror the backend's
 * `SUBTYPES_BY_TYPE` / `AccountSubtype` in `src/constants.py`; the parity test
 * (`tests/test_subtype_frontend_parity.py`) parses these two maps out of this
 * file, so keep them as plain object literals.
 */

/** Sentence-case names for each account type, as the account page shows them. */
export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  current: "Current account",
  savings: "Savings",
  loan: "Loan",
  credit: "Credit",
  invest: "Investment",
};

export const SUBTYPE_LABELS: Record<string, string> = {
  general: "General",
  // Current
  standard: "Standard",
  joint: "Joint",
  student: "Student",
  premier: "Premier",
  basic: "Basic",
  business: "Business",
  // Savings
  cash_isa: "Cash ISA",
  stocks_shares_isa: "Stocks & Shares ISA",
  lifetime_isa: "Lifetime ISA",
  junior_isa: "Junior ISA",
  regular_saver: "Regular Saver",
  easy_access: "Instant Access",
  fixed_term_bond: "Fixed Term Bond",
  notice_account: "Notice Account",
  premium_bonds: "Premium Bonds",
  sipp: "SIPP",
  workplace_pension: "Workplace Pension",
  // Loan
  bank_loan: "Bank Loan",
  mortgage: "Mortgage",
  student_loan: "Student Loan",
  car_finance: "Car Finance",
  overdraft: "Overdraft",
  bnpl: "Buy Now Pay Later",
  // Credit
  credit_card: "Credit Card",
  store_card: "Store Card",
  charge_card: "Charge Card",
  // Invest
  trading_account: "Trading Account",
  crypto: "Crypto",
};

export const SUBTYPES_BY_TYPE: Record<string, string[]> = {
  current: ["general", "standard", "joint", "student", "premier", "basic", "business"],
  savings: [
    "general",
    "easy_access",
    "regular_saver",
    "fixed_term_bond",
    "notice_account",
    "cash_isa",
    "stocks_shares_isa",
    "lifetime_isa",
    "junior_isa",
    "premium_bonds",
    "sipp",
    "workplace_pension",
  ],
  loan: ["general", "mortgage", "bank_loan", "student_loan", "car_finance", "overdraft", "bnpl"],
  credit: ["general", "credit_card", "store_card", "charge_card"],
  invest: ["general", "trading_account", "crypto"],
};

export function accountTypeLabel(type: string): string {
  return ACCOUNT_TYPE_LABELS[type as AccountType] ?? type;
}

/** "Current account · Joint". The catch-all "general" subtype adds nothing, so
 * it's left off rather than shown as "· General". */
export function accountTypeLine(account: { type: string; subtype: string }): string {
  const type = accountTypeLabel(account.type);
  if (!account.subtype || account.subtype === "general") return type;
  return `${type} · ${SUBTYPE_LABELS[account.subtype] ?? account.subtype}`;
}
