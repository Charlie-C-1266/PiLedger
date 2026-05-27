import NavItem from "./NavItem";
import { GridIcon, WalletIcon, ListIcon, FlagIcon, SettingsIcon } from "./icons";
import styles from "./Sidebar.module.css";

interface Props {
  compact?: boolean;
}

export default function Sidebar({ compact }: Props) {
  return (
    <aside className={`${styles.sidebar} ${compact ? styles.compact : ""}`}>
      <div className={styles.brand}>
        <span className={styles.logo}>P</span>
        {!compact && <span className={styles.wordmark}>PiLedger</span>}
      </div>
      <nav className={styles.nav}>
        <NavItem to="/overview" icon={<GridIcon />} label="Overview" compact={compact} />
        <NavItem to="/accounts" icon={<WalletIcon />} label="Accounts" compact={compact} />
        <NavItem to="/transactions" icon={<ListIcon />} label="Transactions" compact={compact} />
        <NavItem to="/goals" icon={<FlagIcon />} label="Goals" compact={compact} />
      </nav>
      <div className={styles.spacer} />
      <NavItem to="/settings" icon={<SettingsIcon />} label="Settings" compact={compact} />
      {!compact && (
        <div className={styles.userCard}>
          <div className={styles.userLabel}>Signed in</div>
          <div className={styles.userName}>User</div>
        </div>
      )}
    </aside>
  );
}
