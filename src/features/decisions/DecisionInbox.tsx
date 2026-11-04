import { useMemo } from "react";
import { Link } from "react-router";
import { ChevronRight, RefreshCw, TriangleAlert } from "lucide-react";
import type { DecisionSummary } from "../../api/adapters/decisions";
import { useGraphDetail } from "../../api/humanGraphReads";
import { useSession } from "../../app/session";
import { useProjects } from "../../app/useProjects";
import { Icon } from "../../components/icons";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { ActionButton } from "../../components/layout/Workspace";
import { formatUntil } from "../../components/time/relative";
import { useServerNow } from "../../components/time/useServerNow";
import { shortId } from "./DecisionContext";
import styles from "./DecisionInbox.module.css";

export type InboxState = "open" | "closed";
const STATE_LABEL: Record<InboxState, string> = { open: "Open", closed: "Resolved" };
const FINAL_LABEL: Record<string, string> = { answered: "Answered", expired: "Expired", cancelled: "Cancelled" };

type Props = {
  state: InboxState;
  onState(state: InboxState): void;
  /** Loaded, de-duplicated rows; undefined while the first page is pending or failed. */
  rows: DecisionSummary[] | undefined;
  error: unknown;
  /** Server time of the most recent page, with the moment it was received. */
  serverTime: number | undefined;
  updatedAt: number;
  selected: string | undefined;
  project: string | undefined;
  fetching: boolean;
  onRefresh(): void;
  more: { available: boolean; loading: boolean; load(): void; limitReached: boolean };
  className?: string;
};

/** Left column of reference 03: Open | Resolved segmented control, refresh, and the review rows. */
export function DecisionInbox({ state, onState, rows, error, serverTime, updatedAt, selected, project, fetching, onRefresh, more, className }: Props) {
  const projects = useProjects();
  const names = useMemo(() => new Map((projects.data?.view ?? []).map(p => [p.id, p.label])), [projects.data]);
  const receivedAt = useMemo(() => performance.now(), [updatedAt]);
  const now = useServerNow(serverTime === undefined ? undefined : { serverTime: new Date(serverTime).toISOString(), receivedAt }, { tickMs: 15_000 });
  return <section className={[styles.pane, className].filter(Boolean).join(" ")} aria-label="Decision inbox" data-inbox="">
    <div className={styles.header}>
      <div className={styles.segmented} role="group" aria-label="Review state">
        {(["open", "closed"] as const).map(s => <button key={s} type="button" className={styles.segment} aria-pressed={s === state} onClick={() => onState(s)}>
          {STATE_LABEL[s]}{s === state && rows && <span className={styles.count}>{rows.length}</span>}
        </button>)}
      </div>
      <button type="button" className={styles.refresh} aria-label="Refresh reviews" title="Refresh reviews" disabled={fetching} onClick={onRefresh}>
        <Icon icon={RefreshCw} size={18} />
      </button>
    </div>
    {!rows ? <div className={styles.status}><QueryStatus status={error ? "error" : "pending"} error={error} label="review inbox" onRetry={onRefresh} /></div> : <>
      {rows.length === 0 ? <p className={styles.empty}>{state === "open" ? "No open reviews" : "No resolved reviews"}</p>
        : <ul className={styles.list} aria-label="Review inbox">{rows.map(r => <li key={r.decisionId}>
          <InboxRow row={r} selected={selected === r.decisionId} projectName={names.get(r.projectId)} now={now} search={new URLSearchParams({ ...(project && { scope: `project:${project}` }), state }).toString()} />
        </li>)}</ul>}
      {(more.available || more.limitReached) && <div className={styles.footer}>
        {more.available && <ActionButton disabled={more.loading} onClick={more.load}>Load more reviews</ActionButton>}
        {more.limitReached && <p className={styles.meta}>Page limit reached. Refresh to begin again.</p>}
      </div>}
    </>}
  </section>;
}

function InboxRow({ row: r, selected, projectName, now, search }: { row: DecisionSummary; selected: boolean; projectName: string | undefined; now: string | null; search: string }) {
  const { bootstrap } = useSession();
  const graphReadable = bootstrap.capability("human.graph.read").enabled;
  const task = useGraphDetail(graphReadable ? r.projectId : "", "task", r.taskId);
  const title = task.data?.data.title ?? `Review task ${r.taskId.slice(0, 8)}`;
  const project = projectName ?? `Project ${shortId(r.projectId)}`;
  let timing: string | null = FINAL_LABEL[r.state] ?? null;
  if (r.state === "pending" && now) {
    const until = formatUntil(now, new Date(r.expires).toISOString());
    timing = until === "due now" ? "Expiry due now" : `Expires ${until}`;
  }
  return <Link className={styles.row} aria-current={selected ? "page" : undefined} to={{ pathname: `/decisions/${r.decisionId}`, search }}>
    <span className={styles.body}>
      <strong className={styles.title}>{title}</strong>
      <span className={styles.meta}>{project} · Review</span>
      {timing && <span className={styles.meta}>{timing}</span>}
      {!r.current && <span className={styles.chip}><Icon icon={TriangleAlert} size={14} />Newer report exists</span>}
    </span>
    <Icon icon={ChevronRight} size={18} className={styles.chevron} />
  </Link>;
}
