import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { createToken, deleteToken } from "../../api/client";
import { useTokens } from "../../hooks/useTokens";
import { useInvalidate } from "../../hooks/useInvalidate";
import type { TokenCreated } from "../../types";
import SettingsCard from "./SettingsCard";
import styles from "./Settings.module.css";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function ApiTokensCard() {
  const inv = useInvalidate();
  const { data: tokens } = useTokens();
  const [name, setName] = useState("");
  // The raw value of the token just minted — shown once, then discarded. Never
  // persisted anywhere; the server only ever stores its hash.
  const [minted, setMinted] = useState<TokenCreated | null>(null);
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: createToken,
    onSuccess: (created) => {
      inv.tokenChanged();
      setMinted(created);
      setCopied(false);
      setName("");
      setMsg(null);
    },
    onError: (err: Error) => {
      setMsg(
        err.message.includes("422")
          ? "Give the token a name (1–100 characters)."
          : "Couldn't create the token — please try again."
      );
    },
  });

  const revokeMutation = useMutation({
    mutationFn: deleteToken,
    onSuccess: () => inv.tokenChanged(),
  });

  const handleCreate = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setMsg(null);
    createMutation.mutate(trimmed);
  };

  const handleCopy = async () => {
    if (!minted) return;
    try {
      await navigator.clipboard.writeText(minted.token);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <SettingsCard title="Personal access tokens">
      <div className={styles.hint} style={{ marginBottom: 16 }}>
        Let scripts and the companion{" "}
        <a
          href="https://github.com/Charlie-C-1266/piledger-mcp"
          target="_blank"
          rel="noreferrer"
        >
          MCP server
        </a>{" "}
        reach your data without your password — send a token as an{" "}
        <code>Authorization: Bearer</code> header. Revoke one here to cut off its
        access immediately.
      </div>

      {minted && (
        <div className={styles.tokenReveal}>
          <div className={styles.label}>New token “{minted.name}”</div>
          <div className={styles.hint} style={{ marginBottom: 8 }}>
            Copy it now — this is the only time the full token is shown.
          </div>
          <code className={styles.tokenCode}>{minted.token}</code>
          <div className={styles.tokenRevealActions}>
            <button className={styles.primaryBtn} onClick={handleCopy}>
              {copied ? "Copied!" : "Copy"}
            </button>
            <button
              className={styles.outlineBtn}
              onClick={() => {
                setMinted(null);
                setCopied(false);
              }}
            >
              Done
            </button>
          </div>
        </div>
      )}

      {(tokens?.length ?? 0) > 0 && (
        <div className={styles.categoryList}>
          {tokens!.map((t) => (
            <div key={t.id} className={styles.categoryRow}>
              <div>
                <div className={styles.categoryName}>{t.name}</div>
                <div className={styles.hint}>
                  Created {fmtDate(t.created_at)} ·{" "}
                  {t.last_used_at
                    ? `last used ${fmtDate(t.last_used_at)}`
                    : "never used"}
                </div>
              </div>
              <button
                className={styles.categoryDeleteBtn}
                onClick={() => revokeMutation.mutate(t.id)}
                disabled={revokeMutation.isPending}
                aria-label={`Revoke ${t.name}`}
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}

      <div className={styles.form} style={{ marginTop: 12 }}>
        <div className={styles.categoryInputRow}>
          <input
            className={styles.input}
            placeholder="Token name (e.g. MCP server)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            maxLength={100}
            autoComplete="off"
          />
          <button
            className={styles.primaryBtn}
            onClick={handleCreate}
            disabled={!name.trim() || createMutation.isPending}
          >
            {createMutation.isPending ? "Creating…" : "Create"}
          </button>
        </div>
        {msg && <div className={styles.errorMsg}>{msg}</div>}
      </div>
    </SettingsCard>
  );
}
