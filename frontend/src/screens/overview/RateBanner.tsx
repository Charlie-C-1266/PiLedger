import { Link } from "react-router-dom";
import { useSummary } from "../../hooks/useSummary";
import styles from "../Overview.module.css";

/**
 * Warning banner shown above the dashboard when one or more currencies have no
 * exchange rate and are being converted at 1:1, so the net-worth headline may be
 * inaccurate. Links to Settings to set rates. Renders nothing when every rate is
 * set (or while the summary is still loading).
 */
export default function RateBanner() {
  const { data: summary } = useSummary();
  if (!summary || summary.missing_rates.length === 0) return null;

  const missing = summary.missing_rates;
  return (
    <Link to="/settings" className={styles.rateBanner}>
      <span>
        ⚠ Net worth may be inaccurate — {missing.join(", ")}{" "}
        {missing.length > 1 ? "have" : "has"} no exchange rate and{" "}
        {missing.length > 1 ? "are" : "is"} converted at 1:1.
      </span>
      <span className={styles.rateBannerCta}>Set rates →</span>
    </Link>
  );
}
