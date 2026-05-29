import { useState } from "react";
import { useTheme } from "../theme/useTheme";
import { SunIcon, MoonIcon, PlusIcon, SearchIcon, LogoMark } from "./icons";
import AddMenu from "./AddMenu";
import type { AddTarget } from "./AddMenu";
import styles from "./Header.module.css";

interface Props {
  mobile?: boolean;
  onAdd?: (target: AddTarget) => void;
  username?: string;
}

export default function Header({ mobile, onAdd, username }: Props) {
  const { mode, toggleMode } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleSelect = (target: AddTarget) => {
    setMenuOpen(false);
    onAdd?.(target);
  };

  if (mobile) {
    return (
      <header className={styles.headerMobile}>
        <span className={styles.mobileBrand}>
          <span className={styles.logo}>
            <LogoMark />
          </span>
        </span>
        <div className={styles.actions}>
          <button className={styles.toggleBtn} onClick={toggleMode} aria-label="Toggle theme">
            {mode === "light" ? <MoonIcon /> : <SunIcon />}
          </button>
          <div className={styles.addWrap}>
            <button
              className={styles.addBtnMobile}
              aria-label="Add"
              onClick={() => setMenuOpen((o) => !o)}
            >
              <PlusIcon />
            </button>
            {menuOpen && <AddMenu onSelect={handleSelect} onClose={() => setMenuOpen(false)} />}
          </div>
        </div>
      </header>
    );
  }

  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <header className={styles.header}>
      <div className={styles.left}>
        <div className={styles.date}>{today}</div>
        <div className={styles.greeting}>Hey there{username ? `, ${username}` : ""} 👋</div>
      </div>
      <div className={styles.actions}>
        <div className={styles.searchPill}>
          <SearchIcon />
          <span className={styles.searchPlaceholder}>Search</span>
        </div>
        <button className={styles.toggleBtn} onClick={toggleMode} aria-label="Toggle theme">
          {mode === "light" ? <MoonIcon /> : <SunIcon />}
        </button>
        <div className={styles.addWrap}>
          <button className={styles.addBtn} onClick={() => setMenuOpen((o) => !o)}>
            <PlusIcon /> Add
          </button>
          {menuOpen && <AddMenu onSelect={handleSelect} onClose={() => setMenuOpen(false)} />}
        </div>
      </div>
    </header>
  );
}
