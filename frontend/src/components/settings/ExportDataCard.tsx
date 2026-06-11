import { useMutation } from "@tanstack/react-query";
import { exportData } from "../../api/client";
import SettingsCard from "./SettingsCard";
import styles from "./Settings.module.css";

export default function ExportDataCard() {
  const exportMutation = useMutation({ mutationFn: exportData });

  return (
    <SettingsCard title="Your data">
      <div className={styles.row}>
        <div>
          <div className={styles.label}>Export my data</div>
          <div className={styles.hint}>
            Download all your accounts, transactions, budgets, and goals as a
            JSON file
          </div>
        </div>
        <button
          className={styles.outlineBtn}
          onClick={() => exportMutation.mutate()}
          disabled={exportMutation.isPending}
        >
          {exportMutation.isPending ? "Exporting…" : "Export"}
        </button>
      </div>
      {exportMutation.isError && (
        <div className={styles.errorMsg}>
          Couldn&apos;t export your data — please try again.
        </div>
      )}
    </SettingsCard>
  );
}
