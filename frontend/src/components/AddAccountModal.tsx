import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createAccount, recordBalance } from "../api/client";
import { PRESET_COLORS, colorToGradient } from "../theme/swatches";
import { CURRENCIES } from "../lib/currency";
import { useIsMobile } from "../hooks/useIsMobile";
import { useSummary } from "../hooks/useSummary";
import styles from "./AddModal.module.css";

const TYPES = [
  { value: "current", label: "Current Account" },
  { value: "savings", label: "Savings Account" },
  { value: "credit", label: "Credit" },
  { value: "invest", label: "Investment" },
  { value: "loan", label: "Loan" },
];

const SUBTYPE_LABELS: Record<string, string> = {
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

const SUBTYPES_BY_TYPE: Record<string, string[]> = {
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

const DEFAULT_COLOR = "#6366f1";

interface Props {
  onClose: () => void;
}

export default function AddAccountModal({ onClose }: Props) {
  const mobile = useIsMobile();
  const { data: summary } = useSummary();
  const [name, setName] = useState("");
  const [type, setType] = useState("current");
  const [subtype, setSubtype] = useState("general");
  const [balance, setBalance] = useState("");
  const [interestRate, setInterestRate] = useState("");
  const [currency, setCurrency] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [customColor, setCustomColor] = useState("");
  const [countsToNetWorth, setCountsToNetWorth] = useState(true);
  const queryClient = useQueryClient();

  // Default to the user's base currency; fall back to GBP until summary loads.
  const baseCurrency = summary?.base_currency ?? "GBP";
  const selectedCurrency = currency || baseCurrency;

  const handleTypeChange = (newType: string) => {
    setType(newType);
    setSubtype("general");
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const rate = parseFloat(interestRate);
      const account = await createAccount({
        name: name.trim(),
        type,
        subtype,
        color,
        currency: selectedCurrency,
        interest_rate: !isNaN(rate) && rate >= 0 ? rate : 0,
        counts_to_net_worth: countsToNetWorth,
      });
      const parsed = parseFloat(balance);
      if (!isNaN(parsed)) {
        await recordBalance(account.id, parsed);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["summary"] });
      queryClient.invalidateQueries({ queryKey: ["networth"] });
      onClose();
    },
  });

  const handleCustomColorChange = (val: string) => {
    setCustomColor(val);
    if (/^#[0-9a-fA-F]{6}$/.test(val)) {
      setColor(val.toLowerCase());
    }
  };

  const handleSave = () => {
    if (!name.trim()) return;
    mutation.mutate();
  };

  const sw = colorToGradient(color);
  const cardPreview = `linear-gradient(135deg, ${sw.start}, ${sw.end})`;

  return (
    <div
      className={`${styles.backdrop} ${mobile ? styles.backdropMobile : ""}`}
      onClick={onClose}
    >
      <div
        className={`${styles.modal} ${mobile ? styles.sheet : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        {mobile && <div className={styles.handle} />}
        <h2 className={styles.title}>Add account</h2>

        <input
          className={styles.input}
          placeholder="Account name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
          autoFocus
        />

        <input
          className={styles.input}
          placeholder="Current balance (e.g. 2500.00)"
          value={balance}
          onChange={(e) => setBalance(e.target.value)}
          inputMode="decimal"
        />

        <select
          className={styles.select}
          value={selectedCurrency}
          onChange={(e) => setCurrency(e.target.value)}
          aria-label="Account currency"
        >
          {CURRENCIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} — {c.name}
              {c.code === baseCurrency ? " (base)" : ""}
            </option>
          ))}
        </select>

        <select
          className={styles.select}
          value={type}
          onChange={(e) => handleTypeChange(e.target.value)}
          aria-label="Account type"
        >
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>

        <select
          className={styles.select}
          value={subtype}
          onChange={(e) => setSubtype(e.target.value)}
          aria-label="Account subtype"
        >
          {SUBTYPES_BY_TYPE[type].map((s) => (
            <option key={s} value={s}>
              {SUBTYPE_LABELS[s]}
            </option>
          ))}
        </select>

        <input
          className={styles.input}
          placeholder="Interest rate % p.a. (optional, e.g. 4.5)"
          value={interestRate}
          onChange={(e) => setInterestRate(e.target.value)}
          inputMode="decimal"
        />

        {/* Colour picker */}
        <div className={styles.colorSection}>
          <span className={styles.colorLabel}>Card colour</span>
          <div className={styles.colorRow}>
            {/* Live card preview swatch */}
            <div
              className={styles.colorPreview}
              style={{ background: cardPreview }}
              aria-label="Card colour preview"
            />
            {/* Preset colour chips */}
            <div className={styles.colorSwatches}>
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  className={`${styles.colorSwatch} ${c === color ? styles.colorSwatchActive : ""}`}
                  style={{ background: c }}
                  onClick={() => {
                    setColor(c);
                    setCustomColor("");
                  }}
                  aria-label={`Select colour ${c}`}
                  title={c}
                />
              ))}
            </div>
          </div>
          {/* Custom hex input */}
          <input
            className={`${styles.input} ${styles.colorHexInput}`}
            placeholder="Custom hex  e.g. #a78bfa"
            value={customColor}
            onChange={(e) => handleCustomColorChange(e.target.value)}
            maxLength={7}
            spellCheck={false}
            autoComplete="off"
          />
        </div>

        <div className={styles.toggleRow}>
          <span className={styles.toggleText}>
            <span className={styles.toggleLabel}>Count toward net worth</span>
            <span className={styles.toggleHint}>
              Off keeps this account out of your Overview headline and trend.
            </span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={countsToNetWorth}
            aria-label="Count toward net worth"
            className={`${styles.toggleSwitch} ${countsToNetWorth ? styles.toggleSwitchOn : ""}`}
            onClick={() => setCountsToNetWorth((v) => !v)}
          >
            <span className={styles.toggleKnob} />
          </button>
        </div>

        <div className={styles.footer}>
          <button className={styles.cancel} onClick={onClose}>
            Cancel
          </button>
          <button
            className={styles.save}
            onClick={handleSave}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "Saving…" : "Save account"}
          </button>
        </div>
      </div>
    </div>
  );
}
