import { useEffect, useState } from "react";
import { Link } from "react-router";
import { InteractiveTerminal } from "../InteractiveTerminal";
import { useManualAgents } from "../swarm/manualAgents";
import { useTerminalSession } from "./terminalSession";
import type { Row } from "./terminalRows";
import styles from "./TerminalWorkspace.module.css";

type PaneProps = {
  row: Row; selected: boolean; hidden: boolean; narrowHidden: boolean; expanded: boolean; project: string | null;
  present: boolean; onFocus: () => void; onExpand: () => void; onClose: () => void; search: string;
};
type Session = ReturnType<typeof useTerminalSession>;

function readyToStart(row: Row, session: Session) {
  if (!session.terminalId || session.ended || !session.permitted) return false;
  return row.manual ? session.status === "running" : !["Loading", "Unavailable"].includes(session.status);
}
function useStarted(row: Row, session: Session) {
  const [started, setStarted] = useState(row.status === "running" || (!row.manual && !!row.terminal));
  const ready = readyToStart(row, session);
  useEffect(() => { if (ready) setStarted(true); }, [ready]);
  return started;
}
function emptyMessage(row: Row, session: Session) {
  if (session.ended) return "No live output was observed.";
  if (session.unavailable) return "Session unavailable. You can close this pane or retry later.";
  if (session.terminalId) return "Starting agent…";
  return row.status === "Loading" ? "Loading session…" : "No terminal is available for this session.";
}
function historyLink(row: Row, search: string) {
  const params = new URLSearchParams(search);
  params.set("session", row.key);
  return { pathname: "/agents/history", search: `?${params}` };
}
function PaneOutput({ row, session, started, search }: { row: Row; session: Session; started: boolean; search: string }) {
  if (!session.permitted) return <p role="status" className={styles.empty}>This session is unavailable in this scope. Close this pane to free its slot.</p>;
  return <>
    {session.ended && <div className={styles.ended} role="status">{session.status === "failed" ? "Failed" : "Ended"} · <Link to={historyLink(row, search)}>History</Link></div>}
    <div className={styles.live}>{started && session.terminalId ?
      <InteractiveTerminal terminalId={session.terminalId} name={row.key} label={`${session.title} terminal output`} manual={row.manual} inputEnabled={!session.ended} compact /> :
      <p className={styles.empty}>{emptyMessage(row, session)}</p>}</div>
  </>;
}
function stopAvailable(row: Row, session: Session) {
  return row.manual && session.permitted && !session.ended && session.status !== "Loading";
}
function PaneHeader({ row, session, expanded, onExpand, onClose, stop }: Pick<PaneProps, "row" | "expanded" | "onExpand" | "onClose"> & { session: Session; stop: () => void }) {
  return <header className={styles.paneHead}>
      <strong>{session.title}</strong><span>{session.permitted ? session.status : "Unavailable"}</span>
      <button onClick={onExpand}>{expanded ? "Restore" : "Expand"}</button>
      {stopAvailable(row, session) && <button disabled={session.status === "stopping"} onClick={stop}>Stop</button>}
      <button onClick={onClose} aria-label={`Close ${session.title} pane`}>Close</button>
    </header>;
}
export function Pane(props: PaneProps) {
  const { row, selected, hidden, narrowHidden, expanded, project, present, onFocus, onExpand, onClose, search } = props;
  const manual = useManualAgents();
  const [error, setError] = useState<string | null>(null);
  const session = useTerminalSession(row, project, present, manual?.error);
  const started = useStarted(row, session);
  function stop() {
    void manual?.stop(row.id).catch(() => setError("Stop could not be confirmed."));
  }
  return <section className={styles.pane} data-selected={selected || undefined} data-hidden={hidden || undefined} data-narrow-hidden={narrowHidden || undefined}
    onFocusCapture={onFocus} onClick={onFocus} aria-label={`${session.title} terminal`}>
    <PaneHeader row={row} session={session} expanded={expanded} onExpand={onExpand} onClose={onClose} stop={stop} />
    {error && <p role="alert">{error}</p>}
    <PaneOutput row={row} session={session} started={started} search={search} />
  </section>;
}
