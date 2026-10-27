import { useMemo, useState } from "react";
import { useAccountProjection } from "../../hooks/useAccountProjection";
import { useAccountHistory } from "../../hooks/useAccountHistory";
import { useMoney } from "../../privacy/useMoney";
import HorizonTiles from "../../components/accounts/HorizonTiles";
import ProjectionChart from "../../components/charts/ProjectionChart";
import Skeleton from "../../components/Skeleton";
import {
  DEFAULT_HORIZON,
  buildChartSeries,
  dayShort,
  includesNote,
  lowNote,
} from "./projectionModel";
import type { Account } from "../../types";
import styles from "../AccountPage.module.css";

const isDebt = (a: Pick<Account, "type">) => a.type === "loan" || a.type === "credit";

/**
 * The projection half of the account page's balance card: "Projected
 * balance", the four horizon tiles that pick the chart's range, the chart, and
 * a note on its low point and what it includes. One 12-month projection and one
 * 90-day history (with its opening balance) serve every horizon. Closed
 * accounts don't project, so nothing is requested for them.
 */
export default function ProjectionPanel({ account }: { account: Account }) {
  const { fmt } = useMoney();
  const [months, setMonths] = useState(DEFAULT_HORIZON);
  const open = !account.closed;
  const projection = useAccountProjection(account.id, { enabled: open });
  const history = useAccountHistory(account.id, "90D", { opening: true, enabled: open });
  const debt = isDebt(account);
  const earnsInterest = !debt && (account.interest_rate ?? 0) > 0;

  const data = projection.data;
  const horizon =
    data?.horizons.find((h) => h.months === months) ?? data?.horizons[data.horizons.length - 1];
  const series = useMemo(
    () => (data && horizon ? buildChartSeries(data, history.data, horizon) : null),
    [data, history.data, horizon],
  );
  // "Warn me below": the page's notes and tints use it, zero when unset.
  const threshold = account.low_balance_threshold ?? 0;
  const note = series && horizon ? lowNote(series, horizon.months, debt, threshold) : null;

  let body;
  if (!open) {
    body = <div className={styles.noProjection}>Closed accounts don't project</div>;
  } else if (projection.isPending || history.isPending) {
    body = (
      <div aria-busy="true">
        <span className="sr-only">Loading projection</span>
        <div className={styles.tileSkeletons}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} height={74} radius={14} />
          ))}
        </div>
        <Skeleton height={240} radius={12} style={{ marginTop: 24 }} />
      </div>
    );
  } else if (!data || !horizon || !series) {
    body = <div className={styles.noProjection}>Couldn't load the projection.</div>;
  } else {
    body = (
      <>
        <HorizonTiles
          horizons={data.horizons}
          selected={horizon.months}
          onSelect={setMonths}
          currency={account.currency}
          labelledBy="account-projection-title"
        />
        <div className={styles.chartArea}>
          <ProjectionChart
            series={series}
            months={horizon.months}
            currency={account.currency}
            showLow={!debt}
          />
        </div>
        <p className={styles.note}>
          {note?.kind === "overdrawn" && (
            <>
              <strong className={styles.noteWarn}>Goes overdrawn on {dayShort(note.date)}.</strong>{" "}
            </>
          )}
          {note?.kind === "buffer" && (
            <>
              <strong className={styles.noteWarn}>
                Drops below your {fmt(note.threshold, account.currency)} buffer on{" "}
                {dayShort(note.date)}.
              </strong>{" "}
            </>
          )}
          {note?.kind === "low" && (
            <>
              Lowest point {note.phrase}:{" "}
              <strong className={note.balance < threshold ? styles.noteWarn : styles.noteStrong}>
                {fmt(note.balance, account.currency)}
              </strong>{" "}
              on {dayShort(note.date)}
              {note.today ? " (today)" : ""}.{" "}
            </>
          )}
          {includesNote(account.interest_rate, debt)}
        </p>
      </>
    );
  }

  return (
    <div className={styles.projection}>
      <div className={styles.sectionHeader} style={{ marginBottom: 12 }}>
        <div>
          <h2 className={styles.sectionTitle} id="account-projection-title">
            Projected balance
          </h2>
          <div className={styles.sectionSub}>
            {earnsInterest ? "From scheduled transactions and interest" : "From scheduled transactions"}
          </div>
        </div>
        {open && (
          <div className={styles.chartKey} aria-hidden="true">
            <span className={styles.keyItem}>
              <span className={styles.keyLine} />
              Actual
            </span>
            <span className={styles.keyItem}>
              <span className={`${styles.keyLine} ${styles.keyLineProjected}`} />
              Projected
            </span>
          </div>
        )}
      </div>
      {body}
    </div>
  );
}
