import { useTheme } from "../theme/useTheme";
import { SunIcon, MoonIcon, PlusIcon, SearchIcon } from "./icons";
import styles from "./Header.module.css";

interface Props {
  mobile?: boolean;
}

export default function Header({ mobile }: Props) {
  const { mode, toggleMode } = useTheme();

  if (mobile) {
    return (
      <header className={styles.headerMobile}>
        <span className={styles.mobileBrand}>
          <span className={styles.logo}>P</span>
        </span>
        <div className={styles.actions}>
          <button className={styles.toggleBtn} onClick={toggleMode} aria-label="Toggle theme">
            {mode === "light" ? <MoonIcon /> : <SunIcon />}
          </button>
          <button className={styles.addBtnMobile} aria-label="Add">
            <PlusIcon />
          </button>
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
        <div className={styles.greeting}>Hey there 👋</div>
      </div>
      <div className={styles.actions}>
        <div className={styles.searchPill}>
          <SearchIcon />
          <span className={styles.searchPlaceholder}>Search</span>
        </div>
        <button className={styles.toggleBtn} onClick={toggleMode} aria-label="Toggle theme">
          {mode === "light" ? <MoonIcon /> : <SunIcon />}
        </button>
        <button className={styles.addBtn}>
          <PlusIcon /> Add
        </button>
      </div>
    </header>
  );
}
