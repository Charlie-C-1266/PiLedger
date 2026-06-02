import AppearanceCard from "../components/settings/AppearanceCard";
import CategoriesCard from "../components/settings/CategoriesCard";
import ExchangeRatesCard from "../components/settings/ExchangeRatesCard";
import ChangePasswordCard from "../components/settings/ChangePasswordCard";
import HelpCard from "../components/settings/HelpCard";
import SessionCard from "../components/settings/SessionCard";
import DangerZoneCard from "../components/settings/DangerZoneCard";
import styles from "../components/settings/Settings.module.css";

export default function Settings() {
  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>Settings</h1>
      <AppearanceCard />
      <CategoriesCard />
      <ExchangeRatesCard />
      <ChangePasswordCard />
      <HelpCard />
      <SessionCard />
      <DangerZoneCard />
    </div>
  );
}
