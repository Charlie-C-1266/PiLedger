import { useState } from "react";
import type { Account, TxnSort } from "../types";
import styles from "./FilterSheet.module.css";

const SORT_OPTIONS: { key: TxnSort; label: string }[] = [
  { key: "date", label: "Newest" },
  { key: "date_asc", label: "Oldest" },
  { key: "amount", label: "Largest" },
  { key: "amount_asc", label: "Smallest" },
];

interface Props {
  accounts: Account[];
  categories: string[];
  accountFilter: number | "";
  sortKey: TxnSort;
  categoryFilter: string;
  onApply: (next: { account: number | ""; sort: TxnSort; category: string }) => void;
  onClose: () => void;
}

export default function FilterSheet({
  accounts,
  categories,
  accountFilter,
  sortKey,
  categoryFilter,
  onApply,
  onClose,
}: Props) {
  // Draft state: edits stay local until "Apply" so the list doesn't refetch
  // (and the badge doesn't change) mid-edit.
  const [account, setAccount] = useState<number | "">(accountFilter);
  const [sort, setSort] = useState<TxnSort>(sortKey);
  const [category, setCategory] = useState<string>(categoryFilter);

  const dirty =
    (account !== "" ? 1 : 0) +
    (category !== "" ? 1 : 0) +
    (sort !== "date" ? 1 : 0);

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
        <div className={styles.handle} />

        <div className={styles.header}>
          <h2 className={styles.title}>Filters</h2>
          {dirty > 0 && (
            <button
              className={styles.clear}
              onClick={() => {
                setAccount("");
                setSort("date");
                setCategory("");
              }}
            >
              Clear all
            </button>
          )}
        </div>

        <label className={styles.label}>Account</label>
        <select
          className={styles.select}
          value={account}
          onChange={(e) => setAccount(e.target.value ? Number(e.target.value) : "")}
        >
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>

        <label className={styles.label}>Sort by</label>
        <div className={styles.sortRow}>
          {SORT_OPTIONS.map((o) => (
            <button
              key={o.key}
              className={`${styles.sortOption} ${sort === o.key ? styles.sortActive : ""}`}
              onClick={() => setSort(o.key)}
            >
              {o.label}
            </button>
          ))}
        </div>

        {categories.length > 0 && (
          <>
            <label className={styles.label}>Category</label>
            <div className={styles.chips}>
              <button
                className={`${styles.chip} ${!category ? styles.chipActive : ""}`}
                onClick={() => setCategory("")}
              >
                All
              </button>
              {categories.map((c) => (
                <button
                  key={c}
                  className={`${styles.chip} ${c === category ? styles.chipActive : ""}`}
                  onClick={() => setCategory(c === category ? "" : c)}
                >
                  {c}
                </button>
              ))}
            </div>
          </>
        )}

        <button
          className={styles.apply}
          onClick={() => {
            onApply({ account, sort, category });
            onClose();
          }}
        >
          Apply
        </button>
      </div>
    </div>
  );
}
