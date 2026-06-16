import { useSummary } from "../hooks/useSummary";
import { PageStagger, StaggerItem } from "../components/PageStagger";
import RateBanner from "./overview/RateBanner";
import NetWorthHero from "./overview/NetWorthHero";
import StatRow from "./overview/StatRow";
import AccountStack from "./overview/AccountStack";
import RecentActivity from "./overview/RecentActivity";
import DistributionDonut from "./overview/DistributionDonut";
import GoalsProgress from "./overview/GoalsProgress";
import styles from "./Overview.module.css";

/**
 * Dashboard layout shell. Each card is a self-contained section that owns its own
 * data and UI state; this component only arranges them into the two staggered
 * columns. The one piece of data it reads is `set_aside`, which decides whether
 * the stat row widens to four columns — a layout choice that belongs to the grid
 * container (the StaggerItem) rather than to StatRow itself.
 */
export default function Overview() {
  const { data: summary } = useSummary();
  const statRowClass = `${styles.statRow} ${
    (summary?.set_aside ?? 0) !== 0 ? styles.statRowFour : ""
  }`;

  return (
    <>
      <RateBanner />
      <div className={styles.grid}>
        <PageStagger className={styles.left}>
          <StaggerItem className={styles.card}>
            <NetWorthHero />
          </StaggerItem>
          <StaggerItem className={statRowClass}>
            <StatRow />
          </StaggerItem>
          <StaggerItem className={styles.card}>
            <AccountStack />
          </StaggerItem>
          <StaggerItem className={styles.card}>
            <RecentActivity />
          </StaggerItem>
        </PageStagger>

        <PageStagger className={styles.right}>
          <StaggerItem className={styles.card}>
            <DistributionDonut />
          </StaggerItem>
          <StaggerItem className={styles.card}>
            <GoalsProgress />
          </StaggerItem>
        </PageStagger>
      </div>
    </>
  );
}
