import SettingsCard from "./SettingsCard";
import styles from "./Settings.module.css";

export default function HelpCard() {
  return (
    <SettingsCard title="Help">
      <div className={styles.row}>
        <div>
          <div className={styles.label}>Documentation</div>
          <div className={styles.hint}>Guides for setting up accounts, budgets, and more</div>
        </div>
        <a
          className={styles.outlineBtn}
          href="/guide"
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: "inline-block", textDecoration: "none" }}
        >
          Open docs
        </a>
      </div>
    </SettingsCard>
  );
}
