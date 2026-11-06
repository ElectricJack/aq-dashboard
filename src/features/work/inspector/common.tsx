import { createContext, useContext, useMemo, type ReactNode } from "react";
import { CopyValue, shortId } from "../../decisions/DecisionContext";
import { formatAge } from "../../../components/time/relative";
import { useServerNow } from "../../../components/time/useServerNow";
import styles from "./Inspector.module.css";

/**
 * An identifier with the view's one copy control (spec 0004 item 1). `full` shows the whole value (the task ID
 * chip); otherwise a recognisable short form, with the full value in its title and on the clipboard.
 */
export function IdValue({ id, label, full = false }: { id: string; label: string; full?: boolean }) {
  return <span className={full ? styles.idChip : styles.idValue}>
    <code title={id} data-id={label}>{full ? id : shortId(id)}</code><CopyValue value={id} label={label} />
  </span>;
}

const Now = createContext<string | null>(null);
/** Server time for relative ages, anchored on the task read and advanced monotonically. */
export function ServerNow({ serverTime, children }: { serverTime: string; children: ReactNode }) {
  const receivedAt = useMemo(() => performance.now(), [serverTime]);
  const now = useServerNow({ serverTime, receivedAt }, { tickMs: 30_000 });
  return <Now value={now}>{children}</Now>;
}
/** "5m ago", with the exact time in its title. */
export function Ago({ at }: { at: string }) {
  const now = useContext(Now);
  return <time dateTime={at} title={at}>{now ? formatAge(now, at) : at}</time>;
}

/** "Not available on this server": a section whose capability isn't advertised never blocks the view (W69). */
export function NotOffered({ what, reason }: { what: string; reason?: string }) {
  return <p className={styles.meta} role="note">{what} not available on this server{reason ? ` · ${reason}` : ""}.</p>;
}

/** `cancel_requested` → "Cancel requested". */
export const humanize = (value: string) => value.replace(/[_-]+/g, " ").replace(/^./, c => c.toUpperCase());
