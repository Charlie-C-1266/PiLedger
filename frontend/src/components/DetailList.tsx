import { Fragment, type ReactNode } from "react";
import styles from "./DetailList.module.css";

export interface DetailItem {
  label: string;
  value: ReactNode;
  /** A small mark drawn before the value (e.g. an 18px InstitutionMark). */
  mark?: ReactNode;
  /** A short explanation stacked under the value. */
  note?: ReactNode;
}

interface Props {
  items: DetailItem[];
  className?: string;
}

/**
 * Read-only label–value pairs for an object's settings. Editing happens in the
 * relevant modal; callers pass "Not recorded" / "None" rather than a blank.
 */
export default function DetailList({ items, className }: Props) {
  return (
    <dl className={`${styles.list} ${className ?? ""}`}>
      {items.map((item) => (
        <Fragment key={item.label}>
          <dt className={styles.term}>{item.label}</dt>
          <dd className={`${styles.value} ${item.note ? styles.stack : ""}`}>
            {item.note ? (
              <>
                <span className={styles.line}>
                  {item.mark}
                  <span>{item.value}</span>
                </span>
                <span className={styles.note}>{item.note}</span>
              </>
            ) : (
              <>
                {item.mark}
                <span>{item.value}</span>
              </>
            )}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}
