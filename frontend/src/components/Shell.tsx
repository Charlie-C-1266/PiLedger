import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import Header from "./Header";
import TabStrip from "./TabStrip";
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

  useEffect(() => {
    const onResize = () => setLayout(getLayout());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const mobile = layout === "mobile";

  return (
    <div className={`${styles.shell} ${mobile ? styles.mobileShell : ""}`}>
      {!mobile && <Sidebar compact={layout === "compact"} />}
      <main className={`${styles.main} ${mobile ? styles.mainMobile : ""}`}>
        <Header mobile={mobile} />
        {mobile && <TabStrip />}
        <Outlet />
      </main>
    </div>
  );
}
