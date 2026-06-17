import { useState } from "react";
import { PRESET_COLORS, colorToGradient } from "../theme/swatches";
import styles from "./AddModal.module.css";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

interface Props {
  /** Currently selected colour as a hex string. */
  value: string;
  onChange: (hex: string) => void;
  /** Section heading. Defaults to "Card colour". */
  label?: string;
}

/**
 * The account "card colour" picker: a live gradient preview, a row of preset
 * swatches, and a custom-hex input. Selecting a preset or typing a valid 6-digit
 * hex calls `onChange` (the typed value is lower-cased so stored colours stay
 * canonical). Extracted from AddAccountModal / EditAccountModal, which carried
 * verbatim copies of this block.
 */
export default function ColorPicker({
  value,
  onChange,
  label = "Card colour",
}: Props) {
  const [customColor, setCustomColor] = useState("");
  const sw = colorToGradient(value);
  const preview = `linear-gradient(135deg, ${sw.start}, ${sw.end})`;

  const handleCustomColorChange = (val: string) => {
    setCustomColor(val);
    if (HEX_RE.test(val)) onChange(val.toLowerCase());
  };

  return (
    <div className={styles.colorSection}>
      <span className={styles.colorLabel}>{label}</span>
      <div className={styles.colorRow}>
        {/* Live card preview swatch */}
        <div
          className={styles.colorPreview}
          style={{ background: preview }}
          aria-label="Card colour preview"
        />
        {/* Preset colour chips */}
        <div className={styles.colorSwatches}>
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`${styles.colorSwatch} ${c === value ? styles.colorSwatchActive : ""}`}
              style={{ background: c }}
              onClick={() => {
                onChange(c);
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
  );
}
