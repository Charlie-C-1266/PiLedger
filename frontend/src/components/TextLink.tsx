import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronRightIcon } from "./icons";
import styles from "./TextLink.module.css";

interface Props {
  to: string;
  children: ReactNode;
  "aria-label"?: string;
}

/**
 * A quiet text link with a trailing chevron, for "View all" and "Manage" in a
 * card header. Soft text rather than accent so it clears AA in both themes.
 */
export default function TextLink({ to, children, ...rest }: Props) {
  return (
    <Link to={to} className={styles.link} aria-label={rest["aria-label"]}>
      {children}
      <ChevronRightIcon className={styles.icon} aria-hidden="true" />
    </Link>
  );
}
