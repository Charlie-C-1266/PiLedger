import { useState } from "react";
import { useIsMobile } from "../hooks/useIsMobile";
import { FilterIcon } from "./icons";
import { VariantPicker, TypeFilterPicker } from "./CardStack";
import type { StackVariant } from "./CardStack";
import styles from "./StackControls.module.css";

const VARIANTS: { key: StackVariant; label: string }[] = [
  { key: "fan", label: "Fan" },
  { key: "cascade", label: "Cascade" },
  { key: "wave", label: "Wave" },
  { key: "grid", label: "Grid" },
];

interface Props {
  variant: StackVariant;
  onVariantChange: (v: StackVariant) => void;
  typeOptions: { key: string; label: string }[];
  typeValue: string;
  onTypeChange: (v: string) => void;
}

export default function StackControls({
  variant,
  onVariantChange,
  typeOptions,
  typeValue,
  onTypeChange,
}: Props) {
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const hasTypes = typeOptions.length > 1;

  // Desktop: the segmented pickers inline in the section header.
  if (!mobile) {
    return (
      <div className={styles.inline}>
        {hasTypes && (
          <TypeFilterPicker options={typeOptions} value={typeValue} onChange={onTypeChange} />
        )}
        <VariantPicker value={variant} onChange={onVariantChange} />
      </div>
    );
  }

  // Mobile: the pickers wrapped too wide and shoved the heading off-screen, so
  // collapse them behind a filter button that opens a bottom sheet.
  return (
    <>
      <button
        className={styles.trigger}
        onClick={() => setOpen(true)}
        aria-label="View options"
      >
        <FilterIcon width={16} height={16} />
      </button>
      {open && (
        <div className={styles.backdrop} onClick={() => setOpen(false)}>
          <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
            <div className={styles.handle} />
            <h2 className={styles.title}>View options</h2>

            <label className={styles.label}>Layout</label>
            <div className={styles.chips}>
              {VARIANTS.map((v) => (
                <button
                  key={v.key}
                  className={`${styles.chip} ${variant === v.key ? styles.chipActive : ""}`}
                  onClick={() => onVariantChange(v.key)}
                >
                  {v.label}
                </button>
              ))}
            </div>

            {hasTypes && (
              <>
                <label className={styles.label}>Filter by type</label>
                <div className={styles.chips}>
                  <button
                    className={`${styles.chip} ${!typeValue ? styles.chipActive : ""}`}
                    onClick={() => onTypeChange("")}
                  >
                    All
                  </button>
                  {typeOptions.map((t) => (
                    <button
                      key={t.key}
                      className={`${styles.chip} ${typeValue === t.key ? styles.chipActive : ""}`}
                      onClick={() => onTypeChange(typeValue === t.key ? "" : t.key)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </>
            )}

            <button className={styles.done} onClick={() => setOpen(false)}>
              Done
            </button>
          </div>
        </div>
      )}
    </>
  );
}
