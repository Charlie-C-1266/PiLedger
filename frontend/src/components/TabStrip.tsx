import { NavLink } from "react-router-dom";
import { GridIcon, WalletIcon, ListIcon, BudgetIcon, FlagIcon, RepeatIcon, SettingsIcon } from "./icons";
import styles from "./TabStrip.module.css";

const tabs = [
  { to: "/overview", icon: <GridIcon />, label: "Overview" },
  { to: "/accounts", icon: <WalletIcon />, label: "Accounts" },
  { to: "/transactions", icon: <ListIcon />, label: "Txns" },
  { to: "/budget", icon: <BudgetIcon />, label: "Budget" },
  { to: "/goals", icon: <FlagIcon />, label: "Goals" },
  { to: "/subscriptions", icon: <RepeatIcon />, label: "Subs" },
  { to: "/settings", icon: <SettingsIcon />, label: "Settings" },
];

export default function TabStrip() {
  return (
    <nav className={styles.strip}>
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          className={({ isActive }) =>
            `${styles.tab} ${isActive ? styles.active : ""}`
          }
        >
          <span className={styles.icon}>{t.icon}</span>
          <span className={styles.label}>{t.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
