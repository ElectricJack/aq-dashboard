import { useMemo } from "react";
import { Link } from "react-router";
import { ChevronRight, MessageCircleQuestion, RefreshCw, TriangleAlert } from "lucide-react";
import type { DecisionSummary } from "../../api/adapters/decisions";
import type { HostDecision } from "../../api/adapters/hostDecisions";
import { isQuestionExpired, type QuestionSummary } from "../../api/adapters/questions";
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
  reviewsOffered: boolean;
  /** Server time of the most recent page, with the moment it was received. */
  serverTime: number | undefined;
  updatedAt: number;
  selected: string | undefined;
  selectedKind: "review" | "question" | "playbook";
  project: string | undefined;
  fetching: boolean;
  onRefresh(): void;
  more: { available: boolean; loading: boolean; load(): void; limitReached: boolean };
  /** F5 agent questions in the same inbox; undefined when the server does not offer them. */
  questions?: { rows: QuestionSummary[] | undefined; error: unknown; more: boolean; serverTime: number | undefined; updatedAt: number };
  host?: { rows: HostDecision[] | undefined; error: unknown };
  className?: string;
};

/** Left column of reference 03: Open | Resolved segmented control, refresh, and the review rows. */
export function DecisionInbox({ state, onState, rows, error, reviewsOffered, serverTime, updatedAt, selected, selectedKind, project, fetching, onRefresh, more, questions, host, className }: Props) {
  const projects = useProjects();
  const names = useMemo(() => new Map((projects.data?.view ?? []).map(p => [p.id, p.label])), [projects.data]);
  const receivedAt = useMemo(() => performance.now(), [updatedAt]);
  const now = useServerNow(serverTime === undefined ? undefined : { serverTime: new Date(serverTime).toISOString(), receivedAt }, { tickMs: 15_000 });
  const search = new URLSearchParams({ ...(project && { scope: `project:${project}` }), state }).toString();
  const asked = questions?.rows ?? [];
  const playbookRows = host?.rows ?? [];
  const count = (rows?.length ?? 0) + asked.length + playbookRows.length;
  const refreshLabel = host ? "Refresh decisions" : "Refresh reviews";
  const empty = state === "closed" ? `No resolved reviews${questions ? " or questions" : ""}`
    : host ? `No open reviews${questions ? ", questions," : ""} or playbook decisions`
    : `No open reviews${questions ? " or questions" : ""}`;
  const askedAt = useMemo(() => performance.now(), [questions?.updatedAt]);
  const askedNow = useServerNow(questions?.serverTime === undefined ? undefined : { serverTime: new Date(questions.serverTime).toISOString(), receivedAt: askedAt }, { tickMs: 15_000 });
  return <section className={[styles.pane, className].filter(Boolean).join(" ")} aria-label="Decision inbox" data-inbox="">
    <div className={styles.header}>
      <div className={styles.segmented} role="group" aria-label="Review state">
        {(["open", "closed"] as const).map(s => <button key={s} type="button" className={styles.segment} aria-pressed={s === state} onClick={() => onState(s)}>
          {STATE_LABEL[s]}{s === state && (rows || host?.rows) && <span className={styles.count}>{count}</span>}
        </button>)}
      </div>
      <button type="button" className={styles.refresh} aria-label={refreshLabel} title={refreshLabel} disabled={fetching || (!reviewsOffered && !host)} onClick={onRefresh}>
        <Icon icon={RefreshCw} size={18} />
      </button>
    </div>
    {questions?.error ? <p role="status" className={styles.notice}>Agent questions could not be loaded. Refresh to try again.</p> : null}
    {asked.length > 0 && <ul className={styles.list} aria-label="Agent questions">{asked.map(q => <li key={q.decisionId}>
      <QuestionRow row={q} selected={selectedKind === "question" && selected === q.decisionId} projectName={names.get(q.projectId)} now={askedNow} search={`${search}&kind=question`} />
    </li>)}</ul>}
    {questions?.more && <p className={styles.notice}>More questions are waiting. Answer these, then refresh.</p>}
    {host && !host.rows && <div className={styles.status}>
      <QueryStatus status={host.error ? "error" : "pending"} error={host.error} label="playbook decisions" onRetry={onRefresh} retryLabel="playbook decisions" />
    </div>}
    {playbookRows.length > 0 && <ul className={styles.list} aria-label="Playbook decisions">{playbookRows.map(row => <li key={row.handle}>
      <HostRow row={row} selected={selectedKind === "playbook" && selected === row.handle} projectName={names.get(row.projectId)} search={`${search}&kind=playbook`} />
    </li>)}</ul>}
    {!reviewsOffered && host?.rows?.length === 0 && <p className={styles.empty}>No open playbook decisions</p>}
    {!reviewsOffered && state === "closed" && <p className={styles.empty}>Playbook decisions are listed while open.</p>}
    {reviewsOffered && (!rows ? <div className={styles.status}><QueryStatus status={error ? "error" : "pending"} error={error} label="review inbox" onRetry={onRefresh} /></div> : <>
      {rows.length === 0 ? asked.length === 0 && (!host || host.rows?.length === 0) && <p className={styles.empty}>{empty}</p>
        : <ul className={styles.list} aria-label="Review inbox">{rows.map(r => <li key={r.decisionId}>
          <InboxRow row={r} selected={selectedKind === "review" && selected === r.decisionId} projectName={names.get(r.projectId)} now={now} search={search} />
        </li>)}</ul>}
      {(more.available || more.limitReached) && <div className={styles.footer}>
        {more.available && <ActionButton disabled={more.loading} onClick={more.load}>Load more reviews</ActionButton>}
        {more.limitReached && <p className={styles.meta}>Page limit reached. Refresh to begin again.</p>}
      </div>}
    </>)}
  </section>;
}

function HostRow({ row, selected, projectName, search }: { row: HostDecision; selected: boolean; projectName: string | undefined; search: string }) {
  return <Link className={styles.row} aria-current={selected ? "page" : undefined} to={{ pathname: `/decisions/${row.handle}`, search }}>
    <span className={styles.body}>
      <strong className={styles.title}>{row.question}</strong>
      <span className={styles.meta}>{projectName ?? `Project ${shortId(row.projectId)}`} · Playbook decision</span>
      <span className={styles.meta}>{row.namespace}</span>
    </span>
    <Icon icon={ChevronRight} size={18} className={styles.chevron} />
  </Link>;
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

function QuestionRow({ row: q, selected, projectName, now, search }: { row: QuestionSummary; selected: boolean; projectName: string | undefined; now: string | null; search: string }) {
  const { bootstrap } = useSession();
  const task = useGraphDetail(bootstrap.capability("human.graph.read").enabled ? q.projectId : "", "task", q.taskId);
  const title = q.taskTitle ?? task.data?.data.title ?? `Question on task ${q.taskId.slice(0, 8)}`;
  const project = projectName ?? `Project ${shortId(q.projectId)}`;
  let timing: string | null = q.state === "answered" ? "Answered" : null;
  if (q.state === "pending" && now) {
    const until = formatUntil(now, new Date(q.expires).toISOString());
    timing = isQuestionExpired(q, Date.parse(now)) ? "Expired" : until === "due now" ? "Expiry due now" : `Expires ${until}`;
  }
  return <Link className={styles.row} aria-current={selected ? "page" : undefined} to={{ pathname: `/decisions/${q.decisionId}`, search }} data-question-row="">
    <span className={styles.body}>
      <strong className={styles.title}>{title}</strong>
      <span className={styles.meta}><Icon icon={MessageCircleQuestion} size={14} className={styles.kindIcon} />{project} · Question</span>
      <span className={styles.excerpt}>{q.question}</span>
      {timing && <span className={styles.meta}>{timing}</span>}
    </span>
    <Icon icon={ChevronRight} size={18} className={styles.chevron} />
  </Link>;
}
