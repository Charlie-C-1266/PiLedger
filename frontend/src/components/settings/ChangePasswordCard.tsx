import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { changePassword } from "../../api/client";
import SettingsCard from "./SettingsCard";
import styles from "./Settings.module.css";

export default function ChangePasswordCard() {
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const pwMutation = useMutation({
    mutationFn: changePassword,
    onSuccess: () => {
      setPwMsg({ ok: true, text: "Password changed successfully" });
      setCurrentPw("");
      setNewPw("");
    },
    onError: (err: Error) => {
      setPwMsg({ ok: false, text: err.message.includes("401") ? "Current password is incorrect" : "Failed to change password" });
    },
  });

  const handlePasswordChange = () => {
    if (!currentPw || newPw.length < 8) {
      setPwMsg({ ok: false, text: "New password must be at least 8 characters" });
      return;
    }
    setPwMsg(null);
    pwMutation.mutate({ current_password: currentPw, new_password: newPw });
  };

  return (
    <SettingsCard title="Change password">
      <div className={styles.form}>
        <input
          className={styles.input}
          type="password"
          placeholder="Current password"
          value={currentPw}
          onChange={(e) => setCurrentPw(e.target.value)}
          autoComplete="current-password"
        />
        <input
          className={styles.input}
          type="password"
          placeholder="New password (min. 8 characters)"
          value={newPw}
          onChange={(e) => setNewPw(e.target.value)}
          autoComplete="new-password"
        />
        {pwMsg && (
          <div className={pwMsg.ok ? styles.successMsg : styles.errorMsg}>
            {pwMsg.text}
          </div>
        )}
        <button
          className={styles.primaryBtn}
          onClick={handlePasswordChange}
          disabled={pwMutation.isPending}
        >
          {pwMutation.isPending ? "Changing…" : "Change password"}
        </button>
      </div>
    </SettingsCard>
  );
}
