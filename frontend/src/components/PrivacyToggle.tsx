import { usePrivacy } from "../privacy/usePrivacy";
import { EyeIcon, EyeOffIcon } from "./icons";
import styles from "./Header.module.css";

/**
 * The quick "hide my amounts" switch. Sits in the header next to the theme
 * toggle on both layouts, so masking is one tap away when someone can see
 * your screen.
 */
export default function PrivacyToggle() {
  const { hidden, toggle } = usePrivacy();
  const label = hidden ? "Show amounts" : "Hide amounts";

  return (
    <button
      type="button"
      className={styles.toggleBtn}
      onClick={toggle}
      aria-label={label}
      aria-pressed={hidden}
      title={label}
    >
      {hidden ? <EyeOffIcon /> : <EyeIcon />}
    </button>
  );
}
