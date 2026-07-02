import { useEffect, useRef } from "react";
import { WalletIcon, ListIcon, FlagIcon, TransferIcon, UploadIcon } from "./icons";
import styles from "./AddMenu.module.css";

export type AddTarget = "account" | "transaction" | "transfer" | "goal" | "import";

interface Props {
  onSelect: (target: AddTarget) => void;
  onClose: () => void;
}

const items: { target: AddTarget; icon: React.ReactNode; label: string }[] = [
  { target: "account", icon: <WalletIcon />, label: "Account" },
  { target: "transaction", icon: <ListIcon />, label: "Transaction" },
  { target: "transfer", icon: <TransferIcon />, label: "Transfer" },
  { target: "goal", icon: <FlagIcon />, label: "Goal" },
  { target: "import", icon: <UploadIcon />, label: "Import CSV" },
];

export default function AddMenu({ onSelect, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [onClose]);

  return (
    <div className={styles.menu} ref={ref}>
      {items.map((it) => (
        <button
          key={it.target}
          className={styles.item}
          onClick={() => onSelect(it.target)}
        >
          <span className={styles.icon}>{it.icon}</span>
          {it.label}
        </button>
      ))}
    </div>
  );
}
