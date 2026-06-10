import { useEffect, useState } from "react";
import { useMutationState } from "@tanstack/react-query";
import { useRates, useUpdateRates } from "../../hooks/useRates";
import { useSummary } from "../../hooks/useSummary";
import { CURRENCIES } from "../../lib/currency";
import SettingsCard from "./SettingsCard";
import styles from "./Settings.module.css";

type RateRow = { currency: string; rate: string };

// Kept outside component state so an in-progress edit survives a remount of
// this card — the Settings page can remount shortly after navigating to it
// (a Framer Motion AnimatePresence exit-animation artifact), which would
// otherwise reset rateRows to empty mid-edit.
let rateRowsDraft: RateRow[] = [];

/** How recent a save must be for a remounted card to still show its result. */
const SAVE_RESULT_WINDOW_MS = 5_000;

export default function ExchangeRatesCard() {
  const { data: ratesData } = useRates();
  const { data: summary } = useSummary();
  const updateRatesMutation = useUpdateRates();
  const base = ratesData?.base_currency ?? "GBP";
  const [rateRows, setRateRows] = useState<RateRow[]>(rateRowsDraft);
  const [addCurrency, setAddCurrency] = useState("");
  const [rateMsg, setRateMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    rateRowsDraft = rateRows;
  }, [rateRows]);

  // Seed the editor from the saved rates, plus an empty row for any currency an
  // account uses that has no rate yet (summary.missing_rates) so it's directly
  // fillable. Re-seeds when either source changes (e.g. after a save refetch),
  // but preserves any value the user has already typed for a currency — the
  // rates and summary queries can resolve at different times, and resetting
  // unconditionally could wipe out an in-progress edit.
  useEffect(() => {
    if (!ratesData) return;
    setRateRows((prev) => {
      const prevByCurrency = new Map(prev.map((r) => [r.currency, r.rate]));
      const rows = ratesData.rates.map((r) => ({
        currency: r.currency,
        rate: prevByCurrency.get(r.currency) ?? String(r.rate),
      }));
      for (const m of summary?.missing_rates ?? []) {
        if (!rows.some((r) => r.currency === m)) {
          rows.push({ currency: m, rate: prevByCurrency.get(m) ?? "" });
        }
      }
      return rows;
    });
  }, [ratesData, summary]);

  // Show the result of the most recent save by reading the mutation cache
  // (keyed by mutationKey) rather than mutate()'s per-call callbacks — those
  // callbacks are lost if this card remounts mid-save. The recency check
  // means a save made just before a remount still shows its result on the
  // new instance, but revisiting Settings later doesn't resurface stale
  // "saved"/"failed" messages from an earlier session.
  const mutationStates = useMutationState({
    filters: { mutationKey: ["updateRates"] },
    select: (m) => ({ status: m.state.status, submittedAt: m.state.submittedAt }),
  });
  const lastMutation = mutationStates[mutationStates.length - 1];
  const lastStatus = lastMutation?.status;
  const lastSubmittedAt = lastMutation?.submittedAt;

  useEffect(() => {
    if (!lastSubmittedAt) return;
    if (Date.now() - lastSubmittedAt > SAVE_RESULT_WINDOW_MS) return;
    if (lastStatus === "success") {
      setRateMsg({ ok: true, text: "Exchange rates saved" });
    } else if (lastStatus === "error") {
      setRateMsg({
        ok: false,
        text: "Failed to save — check each rate is a positive number",
      });
    }
  }, [lastStatus, lastSubmittedAt]);

  const addableCurrencies = CURRENCIES.filter(
    (c) => c.code !== base && !rateRows.some((r) => r.currency === c.code)
  );

  const handleAddRate = () => {
    if (!addCurrency) return;
    setRateRows((rows) => [...rows, { currency: addCurrency, rate: "" }]);
    setAddCurrency("");
  };

  const handleSaveRates = () => {
    const parsed: { currency: string; rate: number }[] = [];
    for (const r of rateRows) {
      const t = r.rate.trim();
      if (t === "") continue; // skip unfilled rows (e.g. a prompted missing rate)
      const n = Number(t);
      if (!isFinite(n) || n <= 0) {
        setRateMsg({ ok: false, text: `Enter a positive rate for ${r.currency}` });
        return;
      }
      parsed.push({ currency: r.currency, rate: n });
    }
    setRateMsg(null);
    updateRatesMutation.mutate(parsed);
  };

  return (
    <SettingsCard title="Exchange rates">
      <div className={styles.hint} style={{ marginBottom: 16 }}>
        Balances held in other currencies are converted into your base currency
        ({base}) using these manual rates. Enter what one unit of each currency is
        worth in {base} — e.g. 1 USD = 0.79 {base === "USD" ? "GBP" : base}.
      </div>

      {(summary?.missing_rates?.length ?? 0) > 0 && (
        <div className={styles.warnBanner}>
          No rate set for {summary!.missing_rates.join(", ")}. Net worth converts
          {summary!.missing_rates.length > 1 ? " these" : " this"} at 1:1 until you
          set a rate below.
        </div>
      )}

      {rateRows.length > 0 ? (
        <div className={styles.rateList}>
          {rateRows.map((r, i) => (
            <div key={r.currency} className={styles.rateRow}>
              <span className={styles.rateLabel}>1 {r.currency} =</span>
              <input
                className={styles.rateInput}
                inputMode="decimal"
                placeholder="0.00"
                value={r.rate}
                onChange={(e) =>
                  setRateRows((rows) =>
                    rows.map((row, j) =>
                      j === i ? { ...row, rate: e.target.value } : row
                    )
                  )
                }
                aria-label={`Value of 1 ${r.currency} in ${base}`}
              />
              <span className={styles.rateBase}>{base}</span>
              <button
                className={styles.categoryDeleteBtn}
                onClick={() => setRateRows((rows) => rows.filter((_, j) => j !== i))}
                aria-label={`Remove ${r.currency} rate`}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.hint}>No exchange rates set yet.</div>
      )}

      {addableCurrencies.length > 0 && (
        <div className={styles.categoryInputRow} style={{ marginTop: 12 }}>
          <select
            className={styles.input}
            value={addCurrency}
            onChange={(e) => setAddCurrency(e.target.value)}
            aria-label="Add a currency"
          >
            <option value="">Add a currency…</option>
            {addableCurrencies.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
          <button
            className={styles.primaryBtn}
            onClick={handleAddRate}
            disabled={!addCurrency}
            aria-label="Add exchange rate"
          >
            Add
          </button>
        </div>
      )}

      {rateMsg && (
        <div className={rateMsg.ok ? styles.successMsg : styles.errorMsg}>
          {rateMsg.text}
        </div>
      )}

      <button
        className={styles.primaryBtn}
        style={{ marginTop: 12 }}
        onClick={handleSaveRates}
        disabled={updateRatesMutation.isPending}
      >
        {updateRatesMutation.isPending ? "Saving…" : "Save rates"}
      </button>
    </SettingsCard>
  );
}
