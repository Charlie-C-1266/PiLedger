import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { deleteAccount } from "../../api/client";
import SettingsCard from "./SettingsCard";
import styles from "./Settings.module.css";

export default function DangerZoneCard() {
  const [deletePw, setDeletePw] = useState("");
  const [showDelete, setShowDelete] = useState(false);
  const [deleteMsg, setDeleteMsg] = useState("");

  const deleteMutation = useMutation({
    mutationFn: deleteAccount,
    onSuccess: () => {
      window.location.href = "/login";
    },
    onError: (err: Error) => {
      setDeleteMsg(err.message.includes("401") ? "Incorrect password" : "Failed to delete account");
    },
  });

  return (
    <SettingsCard title="Danger zone" danger>
      <div className={styles.row}>
        <div>
          <div className={styles.label}>Delete account</div>
          <div className={styles.hint}>Permanently remove your account and all data</div>
        </div>
        {!showDelete ? (
          <button
            className={styles.dangerBtn}
            onClick={() => setShowDelete(true)}
          >
            Delete account
          </button>
        ) : (
          <div className={styles.deleteConfirm}>
            <input
              className={styles.input}
              type="password"
              placeholder="Confirm your password"
              value={deletePw}
              onChange={(e) => setDeletePw(e.target.value)}
              autoComplete="current-password"
            />
            {deleteMsg && <div className={styles.errorMsg}>{deleteMsg}</div>}
            <div className={styles.deleteActions}>
              <button className={styles.outlineBtn} onClick={() => { setShowDelete(false); setDeletePw(""); setDeleteMsg(""); }}>
                Cancel
              </button>
              <button
                className={styles.dangerBtn}
                onClick={() => deleteMutation.mutate(deletePw)}
                disabled={!deletePw || deleteMutation.isPending}
              >
                {deleteMutation.isPending ? "Deleting…" : "Confirm delete"}
              </button>
            </div>
          </div>
        )}
      </div>
    </SettingsCard>
  );
}
