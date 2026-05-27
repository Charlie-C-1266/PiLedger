import { NavLink } from "react-router-dom";
import styles from "./NavItem.module.css";

interface Props {
  to: string;
  icon: React.ReactNode;
  label: string;
  compact?: boolean;
}

export default function NavItem({ to, icon, label, compact }: Props) {
  return (
    <NavLink
      to={to}
      title={compact ? label : undefined}
      className={({ isActive }) =>
        [styles.item, isActive ? styles.active : "", compact ? styles.compact : ""].join(" ")
      }
    >
      <span className={styles.icon}>{icon}</span>
      {!compact && <span className={styles.label}>{label}</span>}
    </NavLink>
  );
}
