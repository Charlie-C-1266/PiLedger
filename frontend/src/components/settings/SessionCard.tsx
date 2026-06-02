import { useMutation } from "@tanstack/react-query";
import { logout } from "../../api/client";
import SettingsCard from "./SettingsCard";
import styles from "./Settings.module.css";

export default function SessionCard() {
  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      window.location.href = "/login";
    },
  });

  return (
    <SettingsCard title="Session">
      <div className={styles.row}>
        <div>
          <div className={styles.label}>Sign out</div>
          <div className={styles.hint}>End your current session on this device</div>
        </div>
        <button
          className={styles.outlineBtn}
          onClick={() => logoutMutation.mutate()}
          disabled={logoutMutation.isPending}
        >
          {logoutMutation.isPending ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </SettingsCard>
  );
}
