import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { useAccounts } from "../hooks/useAccounts";
import { useMe } from "../hooks/useMe";
import Sidebar from "./Sidebar";
import Header from "./Header";
import TabStrip from "./TabStrip";
import AddAccountModal from "./AddAccountModal";
import AddModal from "./AddModal";
import TransferModal from "./TransferModal";
import AddGoalModal from "./AddGoalModal";
import ImportCsvModal from "./ImportCsvModal";
import SearchModal from "./SearchModal";
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
  const [searchOpen, setSearchOpen] = useState(false);
  const { data: accounts } = useAccounts();
  const { data: me } = useMe();
  const location = useLocation();

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
        <Header
          mobile={mobile}
          onAdd={setModal}
          onSearch={() => setSearchOpen(true)}
          username={me?.username}
        />
        {mobile && <TabStrip />}
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>
      <AnimatePresence>
        {modal === "account" && (
          <AddAccountModal key="account" onClose={() => setModal(null)} />
        )}
        {modal === "transaction" && (
          <AddModal
            key="transaction"
            accountId={defaultAccountId}
            onClose={() => setModal(null)}
          />
        )}
        {modal === "transfer" && (
          <TransferModal key="transfer" onClose={() => setModal(null)} />
        )}
        {modal === "goal" && (
          <AddGoalModal key="goal" onClose={() => setModal(null)} />
        )}
        {modal === "import" && (
          <ImportCsvModal key="import" onClose={() => setModal(null)} />
        )}
      </AnimatePresence>
      {searchOpen && <SearchModal onClose={() => setSearchOpen(false)} />}
    </div>
  );
}
