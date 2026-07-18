import AppearanceCard from "../components/settings/AppearanceCard";
import CategoriesCard from "../components/settings/CategoriesCard";
import ExchangeRatesCard from "../components/settings/ExchangeRatesCard";
import ChangePasswordCard from "../components/settings/ChangePasswordCard";
import HelpCard from "../components/settings/HelpCard";
import ApiTokensCard from "../components/settings/ApiTokensCard";
import SessionCard from "../components/settings/SessionCard";
import ExportDataCard from "../components/settings/ExportDataCard";
import DangerZoneCard from "../components/settings/DangerZoneCard";
import { PageStagger, StaggerItem } from "../components/PageStagger";
import styles from "../components/settings/Settings.module.css";

export default function Settings() {
  return (
    <PageStagger className={styles.page}>
      <StaggerItem><h1 className={styles.pageTitle}>Settings</h1></StaggerItem>
      <StaggerItem><AppearanceCard /></StaggerItem>
      <StaggerItem><CategoriesCard /></StaggerItem>
      <StaggerItem><ExchangeRatesCard /></StaggerItem>
      <StaggerItem><ChangePasswordCard /></StaggerItem>
      <StaggerItem><ApiTokensCard /></StaggerItem>
      <StaggerItem><HelpCard /></StaggerItem>
      <StaggerItem><SessionCard /></StaggerItem>
      <StaggerItem><ExportDataCard /></StaggerItem>
      <StaggerItem><DangerZoneCard /></StaggerItem>
    </PageStagger>
  );
}
