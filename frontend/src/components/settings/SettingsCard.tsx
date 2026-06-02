import type { ReactNode } from "react";
import styles from "./Settings.module.css";

interface Props {
  title: string;
  /** Applies the red-tinted "danger zone" card variant. */
  danger?: boolean;
  children: ReactNode;
}

/** The shared card chrome every Settings section sits in: a surface card with a
    section heading. Renders the same DOM each section used inline before. */
export default function SettingsCard({ title, danger, children }: Props) {
  return (
    <div className={`${styles.card} ${danger ? styles.dangerCard : ""}`}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      {children}
    </div>
  );
}
