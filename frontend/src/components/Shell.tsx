import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { useAccounts } from "../hooks/useAccounts";
import { useMe } from "../hooks/useMe";
import Sidebar from "./Sidebar";
import Header from "./Header";
import TabStrip from "./TabStrip";
import AddAccountModal from "./AddAccountModal";
import AddModal from "./AddModal";
import TransferModal from "./TransferModal";
import AddGoalModal from "./AddGoalModal";
import type { AddTarget } from "./AddMenu";
import styles from "./Shell.module.css";

type Layout = "full" | "compact" | "mobile";

function getLayout(): Layout {
  const w = window.innerWidth;
  if (w >= 1080) return "full";
  if (w >= 720) return "compact";
  return "mobile";
}

export default function Shell() {
  const [layout, setLayout] = useState<Layout>(getLayout);
  const [modal, setModal] = useState<AddTarget | null>(null);
  const { data: accounts } = useAccounts();
  const { data: me } = useMe();

  useEffect(() => {
    const onResize = () => setLayout(getLayout());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const mobile = layout === "mobile";
  const defaultAccountId = accounts?.[0]?.id ?? null;

  return (
    <div className={`${styles.shell} ${mobile ? styles.mobileShell : ""}`}>
      {!mobile && <Sidebar compact={layout === "compact"} username={me?.username} />}
      <main className={`${styles.main} ${mobile ? styles.mainMobile : ""}`}>
        <Header mobile={mobile} onAdd={setModal} username={me?.username} />
        {mobile && <TabStrip />}
        <Outlet />
      </main>
      {modal === "account" && (
        <AddAccountModal onClose={() => setModal(null)} />
      )}
      {modal === "transaction" && (
        <AddModal accountId={defaultAccountId} onClose={() => setModal(null)} />
      )}
      {modal === "transfer" && <TransferModal onClose={() => setModal(null)} />}
      {modal === "goal" && (
        <AddGoalModal onClose={() => setModal(null)} />
      )}
    </div>
  );
}
