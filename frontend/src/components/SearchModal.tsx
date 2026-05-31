import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getTransactions } from "../api/client";
import { useAccounts } from "../hooks/useAccounts";
import { useGoals } from "../hooks/useGoals";
import { useSummary } from "../hooks/useSummary";
import { fmt } from "../lib/currency";
import { SearchIcon, WalletIcon, FlagIcon, ListIcon } from "./icons";
import styles from "./SearchModal.module.css";

interface Props {
  onClose: () => void;
}

type ResultKind = "account" | "goal" | "transaction";

interface Result {
  kind: ResultKind;
  key: string;
  title: string;
  subtitle: string;
  to: string;
}

const GROUP_LABEL: Record<ResultKind, string> = {
  account: "Accounts",
  goal: "Goals",
  transaction: "Transactions",
};

const GROUP_ICON: Record<ResultKind, React.ReactNode> = {
  account: <WalletIcon width={15} height={15} />,
  goal: <FlagIcon width={15} height={15} />,
  transaction: <ListIcon width={15} height={15} />,
};

export default function SearchModal({ onClose }: Props) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [active, setActive] = useState(0);

  const { data: summary } = useSummary();
  const currency = summary?.base_currency ?? "GBP";
  const { data: accounts } = useAccounts();
  const { data: goals } = useGoals();

  // Server-side transaction search — only runs once there's something to match.
  const { data: transactions } = useQuery({
    queryKey: ["transactions", { search: debounced, per_page: 8 }],
    queryFn: () => getTransactions({ search: debounced, per_page: 8 }),
    enabled: debounced.length > 0,
  });

  // Debounce the query that drives the transactions request (accounts/goals
  // are already cached, so they filter instantly off `debounced` too).
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(id);
  }, [query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo<Result[]>(() => {
    const q = debounced.toLowerCase();
    if (!q) return [];
    const accountResults: Result[] = (accounts ?? [])
      .filter((a) => a.name.toLowerCase().includes(q))
      .map((a) => ({
        kind: "account",
        key: `a${a.id}`,
        title: a.name,
        subtitle:
          a.type.charAt(0).toUpperCase() +
          a.type.slice(1) +
          (a.current_balance != null
            ? ` · ${fmt(a.current_balance, a.currency)}`
            : ""),
        to: "/accounts",
      }));
    const goalResults: Result[] = (goals ?? [])
      .filter((g) => g.name.toLowerCase().includes(q))
      .map((g) => ({
        kind: "goal",
        key: `g${g.id}`,
        title: g.name,
        subtitle: `${fmt(g.saved, currency)} of ${fmt(g.target, currency)}`,
        to: "/goals",
      }));
    const txnResults: Result[] = (transactions ?? []).map((t) => ({
      kind: "transaction",
      key: `t${t.id}`,
      title: t.merchant || t.category || "Transaction",
      subtitle: `${fmt(t.amount, currency)} · ${new Date(
        t.occurred_at
      ).toLocaleDateString("en-GB")}`,
      to: `/transactions?q=${encodeURIComponent(debounced)}`,
    }));
    return [...accountResults, ...goalResults, ...txnResults];
  }, [debounced, accounts, goals, transactions, currency]);

  // Keep the active highlight in range as results change.
  useEffect(() => {
    setActive(0);
  }, [results]);

  const select = (r: Result) => {
    navigate(r.to);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[active]) {
      e.preventDefault();
      select(results[active]);
    }
  };

  return (
    <div className={styles.backdrop} onMouseDown={onClose}>
      <div
        className={styles.panel}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Search"
      >
        <div className={styles.searchRow}>
          <SearchIcon width={16} height={16} />
          <input
            ref={inputRef}
            className={styles.input}
            placeholder="Search accounts, goals, transactions…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            autoComplete="off"
            aria-label="Search query"
          />
          <button className={styles.escHint} onClick={onClose} type="button">
            Esc
          </button>
        </div>

        <div className={styles.results}>
          {!debounced && (
            <div className={styles.hint}>
              Start typing to search your accounts, goals and transactions.
            </div>
          )}
          {debounced && results.length === 0 && (
            <div className={styles.empty}>No matches for “{debounced}”.</div>
          )}
          {results.map((r, i) => {
            const showHeader = i === 0 || results[i - 1].kind !== r.kind;
            return (
              <div key={r.key}>
                {showHeader && (
                  <div className={styles.groupHeader}>{GROUP_LABEL[r.kind]}</div>
                )}
                <button
                  className={`${styles.result} ${
                    i === active ? styles.resultActive : ""
                  }`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => select(r)}
                  type="button"
                >
                  <span className={styles.resultIcon}>{GROUP_ICON[r.kind]}</span>
                  <span className={styles.resultText}>
                    <span className={styles.resultTitle}>{r.title}</span>
                    <span className={styles.resultSub}>{r.subtitle}</span>
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
