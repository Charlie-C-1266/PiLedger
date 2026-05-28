import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "../theme/useTheme";
import { ACCENT_OPTIONS } from "../theme/tokens";
import { logout, changePassword, deleteAccount, createCategory, deleteCategory } from "../api/client";
import { useCategories } from "../hooks/useCategories";
import { SunIcon, MoonIcon } from "../components/icons";
import styles from "./Settings.module.css";

export default function Settings() {
  const { mode, accent, toggleMode, setAccent } = useTheme();
  const queryClient = useQueryClient();

  // Categories
  const { data: categoriesData } = useCategories();
  const [newCategoryName, setNewCategoryName] = useState("");
  const [categoryMsg, setCategoryMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const addCategoryMutation = useMutation({
    mutationFn: createCategory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      setNewCategoryName("");
      setCategoryMsg({ ok: true, text: "Category added" });
    },
    onError: (err: Error) => {
      const msg = err.message.includes("409")
        ? "A category with that name already exists"
        : err.message.includes("422")
          ? "Maximum number of custom categories reached"
          : "Failed to add category";
      setCategoryMsg({ ok: false, text: msg });
    },
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: deleteCategory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
  });

  const handleAddCategory = () => {
    const trimmed = newCategoryName.trim();
    if (!trimmed) return;
    setCategoryMsg(null);
    addCategoryMutation.mutate(trimmed);
  };

  // Password change
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

  // Logout
  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => { window.location.href = "/login"; },
  });

  // Delete account
  const [deletePw, setDeletePw] = useState("");
  const [showDelete, setShowDelete] = useState(false);
  const [deleteMsg, setDeleteMsg] = useState("");

  const deleteMutation = useMutation({
    mutationFn: deleteAccount,
    onSuccess: () => { window.location.href = "/login"; },
    onError: (err: Error) => {
      setDeleteMsg(err.message.includes("401") ? "Incorrect password" : "Failed to delete account");
    },
  });

  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>Settings</h1>

      {/* Appearance */}
      <div className={styles.card}>
        <h2 className={styles.sectionTitle}>Appearance</h2>

        <div className={styles.row}>
          <div>
            <div className={styles.label}>Theme mode</div>
            <div className={styles.hint}>Switch between light and dark</div>
          </div>
          <button className={styles.toggleBtn} onClick={toggleMode} aria-label="Toggle theme">
            {mode === "light" ? <MoonIcon /> : <SunIcon />}
            <span>{mode === "light" ? "Dark" : "Light"}</span>
          </button>
        </div>

        <div className={styles.row}>
          <div>
            <div className={styles.label}>Accent colour</div>
            <div className={styles.hint}>Used for buttons, links, and highlights</div>
          </div>
          <div className={styles.swatches}>
            {ACCENT_OPTIONS.map((c) => (
              <button
                key={c}
                className={styles.swatch}
                style={{
                  background: c,
                  border: c === accent ? "2px solid var(--pl-text)" : "2px solid transparent",
                }}
                onClick={() => setAccent(c)}
                aria-label={`Accent ${c}`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Transaction categories */}
      <div className={styles.card}>
        <h2 className={styles.sectionTitle}>Transaction categories</h2>
        <div className={styles.hint} style={{ marginBottom: 16 }}>
          Add custom categories to use alongside the built-in ones when logging transactions.
        </div>
        {(categoriesData?.custom ?? []).length > 0 && (
          <div className={styles.categoryList}>
            {categoriesData!.custom.map((cat) => (
              <div key={cat.id} className={styles.categoryRow}>
                <span className={styles.categoryName}>{cat.name}</span>
                <button
                  className={styles.categoryDeleteBtn}
                  onClick={() => deleteCategoryMutation.mutate(cat.id)}
                  disabled={deleteCategoryMutation.isPending}
                  aria-label={`Delete ${cat.name}`}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
        <div className={styles.form} style={{ marginTop: 12 }}>
          <div className={styles.categoryInputRow}>
            <input
              className={styles.input}
              placeholder="New category name"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddCategory()}
              maxLength={100}
            />
            <button
              className={styles.primaryBtn}
              onClick={handleAddCategory}
              disabled={!newCategoryName.trim() || addCategoryMutation.isPending}
            >
              {addCategoryMutation.isPending ? "Adding…" : "Add"}
            </button>
          </div>
          {categoryMsg && (
            <div className={categoryMsg.ok ? styles.successMsg : styles.errorMsg}>
              {categoryMsg.text}
            </div>
          )}
        </div>
      </div>

      {/* Change password */}
      <div className={styles.card}>
        <h2 className={styles.sectionTitle}>Change password</h2>
        <div className={styles.form}>
          <input
            className={styles.input}
            type="password"
            placeholder="Current password"
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
          />
          <input
            className={styles.input}
            type="password"
            placeholder="New password (min. 8 characters)"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
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
      </div>

      {/* Session */}
      <div className={styles.card}>
        <h2 className={styles.sectionTitle}>Session</h2>
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
      </div>

      {/* Danger zone */}
      <div className={`${styles.card} ${styles.dangerCard}`}>
        <h2 className={styles.sectionTitle}>Danger zone</h2>
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
      </div>
    </div>
  );
}
