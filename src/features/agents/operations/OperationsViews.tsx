import type { SessionDetailView } from "../../../api/adapters/inspection";
import { ActionButton } from "../../../components/layout/Workspace";
import { profileText } from "../labels";
import styles from "./Operations.module.css";

export type OperationsView = "overview" | "health" | "waits" | "notifications" | "profile";
const VIEWS: { id: OperationsView; label: string }[] = [
  { id: "overview", label: "Overview" }, { id: "health", label: "Health" }, { id: "waits", label: "Waits" },
  { id: "notifications", label: "Notifications" }, { id: "profile", label: "Profile" },
];

/** On-demand operations views inside the Details drawer; only the chosen view mounts and reads. */
export function OperationsNav({ view, onView }: { view: OperationsView; onView(v: OperationsView): void }) {
  return <nav aria-label="Session operations" className={styles.nav}>
    {VIEWS.map(v => <ActionButton key={v.id} aria-current={view === v.id || undefined} onClick={() => onView(v.id)}>{v.label}</ActionButton>)}
  </nav>;
}

/** U9: revisions, harness/model, instruction provenance, effective vs requested permissions. No secrets are read. */
export function ProfileView({ session: s }: { session: SessionDetailView }) {
  return <section aria-label="Profile" className={styles.view}>
    <h3>Profile</h3>
    <p>{s.profile.provider ?? "Provider unknown"} · {profileText(s.profile)}</p>
    <h4>Revisions</h4>
    {s.profileRevisions.length ? <ul aria-label="Profile revisions" className={styles.bullets}>{s.profileRevisions.map(p => <li key={p.name}>{p.name} · revision {p.revision}</li>)}</ul>
      : <p className={styles.muted}>No profile revisions recorded.</p>}
    <h4>Instructions</h4>
    <p className={styles.muted}>Instruction provenance not reported by this AQ server.</p>
    <h4>Effective permissions</h4>
    {s.permissions.length ? <ul aria-label="Effective permissions" className={styles.bullets}>{s.permissions.map(p => <li key={p}>{p}</li>)}</ul>
      : <p className={styles.muted}>No effective permissions recorded.</p>}
    <h4>Requested permissions</h4>
    <p className={styles.muted}>Requested permissions not reported by this AQ server, so effective permissions cannot be compared with the request.</p>
  </section>;
}
