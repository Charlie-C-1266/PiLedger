import { useEffect, useState } from "react";
import { useRates, useUpdateRates } from "../../hooks/useRates";
import { useSummary } from "../../hooks/useSummary";
import { CURRENCIES } from "../../lib/currency";
import SettingsCard from "./SettingsCard";
import styles from "./Settings.module.css";

export default function ExchangeRatesCard() {
  const { data: ratesData } = useRates();
  const { data: summary } = useSummary();
  const updateRatesMutation = useUpdateRates();
  const base = ratesData?.base_currency ?? "GBP";
  const [rateRows, setRateRows] = useState<{ currency: string; rate: string }[]>([]);
  const [addCurrency, setAddCurrency] = useState("");
  const [rateMsg, setRateMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Seed the editor from the saved rates, plus an empty row for any currency an
  // account uses that has no rate yet (summary.missing_rates) so it's directly
  // fillable. Re-seeds when either source changes (e.g. after a save refetch).
  useEffect(() => {
    if (!ratesData) return;
    const rows = ratesData.rates.map((r) => ({
      currency: r.currency,
      rate: String(r.rate),
    }));
    for (const m of summary?.missing_rates ?? []) {
      if (!rows.some((r) => r.currency === m)) rows.push({ currency: m, rate: "" });
    }
    setRateRows(rows);
  }, [ratesData, summary]);

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
    updateRatesMutation.mutate(parsed, {
      onSuccess: () => setRateMsg({ ok: true, text: "Exchange rates saved" }),
      onError: () =>
        setRateMsg({ ok: false, text: "Failed to save — check each rate is a positive number" }),
    });
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
