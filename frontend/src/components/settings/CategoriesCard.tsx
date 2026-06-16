import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { createCategory, deleteCategory } from "../../api/client";
import { useCategories } from "../../hooks/useCategories";
import { useInvalidate } from "../../hooks/useInvalidate";
import SettingsCard from "./SettingsCard";
import styles from "./Settings.module.css";

export default function CategoriesCard() {
  const inv = useInvalidate();
  const { data: categoriesData } = useCategories();
  const [newCategoryName, setNewCategoryName] = useState("");
  const [categoryMsg, setCategoryMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const addCategoryMutation = useMutation({
    mutationFn: createCategory,
    onSuccess: () => {
      inv.categoryChanged();
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
      inv.categoryChanged();
    },
  });

  const handleAddCategory = () => {
    const trimmed = newCategoryName.trim();
    if (!trimmed) return;
    setCategoryMsg(null);
    addCategoryMutation.mutate(trimmed);
  };

  return (
    <SettingsCard title="Transaction categories">
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
            autoComplete="off"
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
    </SettingsCard>
  );
}
