import { CheckIcon, MinusIcon } from "./icons";
import styles from "./NetWorthChip.module.css";

interface Props {
  countsToNetWorth: boolean;
  closed: boolean;
}

/**
 * Says at a glance whether an account counts toward net worth. It only reports
 * the state — the setting itself lives in Edit account. "Closed" replaces the
 * other two, since a closed account's standing is the more useful fact.
 */
export default function NetWorthChip({ countsToNetWorth, closed }: Props) {
  if (closed) {
    return <span className={`${styles.chip} ${styles.excluded}`}>Closed</span>;
  }
  if (countsToNetWorth) {
    return (
      <span className={`${styles.chip} ${styles.included}`}>
        <CheckIcon className={styles.icon} aria-hidden="true" />
        Counts toward net worth
      </span>
    );
  }
  return (
    <span className={`${styles.chip} ${styles.excluded}`}>
      <MinusIcon className={styles.icon} aria-hidden="true" />
      Set aside
    </span>
  );
}
