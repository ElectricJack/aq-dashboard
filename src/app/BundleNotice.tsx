import { useState } from "react";
import { useSession } from "./session";
import { saveDraftsBeforeReload } from "./drafts";
import styles from "./BundleNotice.module.css";
import { UPGRADE_PATH } from "./compatibility";

export function BundleNotice() {
  const { updateAvailable, bootstrap } = useSession();
  const incompatible = bootstrap.compatibilityIssues.length > 0;
  const [storageFailed, setStorageFailed] = useState(false);
  if (!updateAvailable && !incompatible) return null;
  return <aside className={styles.notice} aria-label="Dashboard version" role="note">
    <span>{updateAvailable ? "A new dashboard version is available — " : `Some features require a compatible AQ server and dashboard. ${UPGRADE_PATH} `}<button type="button" onClick={() => {
      if (saveDraftsBeforeReload()) window.location.reload();
      else setStorageFailed(true);
    }}>Reload</button></span>
    {updateAvailable && incompatible && <span>{UPGRADE_PATH}</span>}
    {storageFailed && <p role="alert">Draft recovery is unavailable in this tab. Copy your drafts before reloading.</p>}
  </aside>;
}
