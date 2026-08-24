import { useTheme } from "../../theme/useTheme";
import { usePrivacy } from "../../privacy/usePrivacy";
import { ACCENT_OPTIONS } from "../../theme/tokens";
import { SunIcon, MoonIcon, EyeIcon, EyeOffIcon } from "../icons";
import SettingsCard from "./SettingsCard";
import styles from "./Settings.module.css";

export default function AppearanceCard() {
  const { mode, accent, toggleMode, setAccent } = useTheme();
  const { hidden, toggle: togglePrivacy } = usePrivacy();

  return (
    <SettingsCard title="Appearance">
      <div className={styles.row}>
        <div>
          <div className={styles.label}>Theme mode</div>
          <div className={styles.hint}>Switch between light and dark</div>
        </div>
        <button className={styles.toggleBtn} onClick={toggleMode} aria-label="Toggle theme">
          {mode === "light" ? <MoonIcon /> : <SunIcon />}
          <span>{mode === "light" ? "Dark" : "Light"}</span>
        </button>
      </div>

      <div className={styles.row}>
        <div>
          <div className={styles.label}>Hide amounts</div>
          <div className={styles.hint}>
            Mask every amount on screen — same as the eye button in the header
          </div>
        </div>
        <button
          className={styles.toggleBtn}
          onClick={togglePrivacy}
          aria-label={hidden ? "Show amounts" : "Hide amounts"}
          aria-pressed={hidden}
        >
          {hidden ? <EyeOffIcon /> : <EyeIcon />}
          <span>{hidden ? "Show" : "Hide"}</span>
        </button>
      </div>

      <div className={styles.row}>
        <div>
          <div className={styles.label}>Accent colour</div>
          <div className={styles.hint}>Used for buttons, links, and highlights</div>
        </div>
        <div className={styles.swatches}>
          {ACCENT_OPTIONS.map((c) => (
            <button
              key={c}
              className={styles.swatch}
              style={{
                background: c,
                border: c === accent ? "2px solid var(--pl-text)" : "2px solid transparent",
              }}
              onClick={() => setAccent(c)}
              aria-label={`Accent ${c}`}
            />
          ))}
        </div>
      </div>
    </SettingsCard>
  );
}
