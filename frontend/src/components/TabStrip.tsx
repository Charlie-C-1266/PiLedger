import { useEffect, useRef } from "react";
import { NavLink, useLocation } from "react-router-dom";
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
  const navRef = useRef<HTMLElement>(null);
  const { pathname } = useLocation();

  // The strip scrolls horizontally when the tabs overflow, so keep the active
  // destination in view as the route changes.
  useEffect(() => {
    const active = navRef.current?.querySelector('[aria-current="page"]');
    active?.scrollIntoView?.({ inline: "center", block: "nearest" });
  }, [pathname]);

  return (
    <nav ref={navRef} className={styles.strip}>
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
