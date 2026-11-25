import { useMemo, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import type { DecisionSummary } from "../../api/adapters/decisions";
import type { HostDecision } from "../../api/adapters/hostDecisions";
import type { QuestionSummary } from "../../api/adapters/questions";
import { useProjects } from "../../app/useProjects";
import { Icon } from "../../components/icons";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { ActionButton } from "../../components/layout/Workspace";
import { useDecisionClock } from "./decisionHooks";
import { HostRow, InboxRow, QuestionRow } from "./InboxRows";
import styles from "./DecisionInbox.module.css";

export type InboxState = "open" | "closed";
const STATE_LABEL: Record<InboxState, string> = { open: "Open", closed: "Resolved" };


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

function emptyInbox(state: InboxState, questions: boolean, host: boolean) {
  const suffix = questions ? " or questions" : "";
  if (state === "closed") return `No resolved reviews${suffix}`;
  if (!host) return `No open reviews${suffix}`;
  return questions ? "No open reviews, questions, or playbook decisions" : "No open reviews or playbook decisions";
}

type RowLinks = { names: Map<string, string>; search: string; selected?: string };

function StateControl({ state, onState, count }: Pick<Props, "state" | "onState"> & { count?: number }) {
  return <div className={styles.segmented} role="group" aria-label="Review state">
    {(["open", "closed"] as const).map(s => <button key={s} type="button" className={styles.segment} aria-pressed={s === state} onClick={() => onState(s)}>
      {STATE_LABEL[s]}{s === state && count !== undefined && <span className={styles.count}>{count}</span>}
    </button>)}
  </div>;
}

function InboxHeader({ inbox, count }: { inbox: Props; count: number }) {
  const { state, onState, rows, host, fetching, reviewsOffered, onRefresh } = inbox;
  const refreshLabel = host ? "Refresh decisions" : "Refresh reviews";
  return <div className={styles.header}>
    <StateControl state={state} onState={onState} count={rows || host?.rows ? count : undefined} />
    <button type="button" className={styles.refresh} aria-label={refreshLabel} title={refreshLabel} disabled={fetching || (!reviewsOffered && !host)} onClick={onRefresh}>
      <Icon icon={RefreshCw} size={18} />
    </button>
  </div>;
}

function InboxList<T>({ label, rows, rowKey, children }: { label: string; rows: T[]; rowKey(row: T): string; children(row: T): ReactNode }) {
  if (!rows.length) return null;
  return <ul className={styles.list} aria-label={label}>
    {rows.map(row => <li key={rowKey(row)}>{children(row)}</li>)}
  </ul>;
}

function QuestionList({ asked, questions, links }: { asked: QuestionSummary[]; questions: Props["questions"]; links: RowLinks }) {
  const { names, search, selected } = links;
  const { serverTime, updatedAt, error, more } = questions ?? {};
  const askedNow = useDecisionClock(serverTime, updatedAt);
  return <>
    {error ? <p role="status" className={styles.notice}>Agent questions could not be loaded. Refresh to try again.</p> : null}
    <InboxList label="Agent questions" rows={asked} rowKey={q => q.decisionId}>{q =>
      <QuestionRow row={q} selected={selected === q.decisionId} projectName={names.get(q.projectId)} now={askedNow} search={`${search}&kind=question`} />
    }</InboxList>
    {more && <p className={styles.notice}>More questions are waiting. Answer these, then refresh.</p>}
  </>;
}

function HostReadStatus({ host, onRefresh }: Pick<Props, "host" | "onRefresh">) {
  if (!host || host.rows) return null;
  return <div className={styles.status}>
    <QueryStatus status={host.error ? "error" : "pending"} error={host.error} label="playbook decisions" onRetry={onRefresh} retryLabel="playbook decisions" />
  </div>;
}

function PlaybookDecisions({ inbox, links, rows }: { inbox: Props; links: RowLinks; rows: HostDecision[] }) {
  const { names, search, selected } = links;
  const { host, onRefresh, reviewsOffered, state } = inbox;
  return <>
    <HostReadStatus host={host} onRefresh={onRefresh} />
    <InboxList label="Playbook decisions" rows={rows} rowKey={row => row.handle}>{row =>
      <HostRow row={row} selected={selected === row.handle} projectName={names.get(row.projectId)} search={`${search}&kind=playbook`} />
    }</InboxList>
    {!reviewsOffered && <PlaybookOnlyState host={host} state={state} />}
  </>;
}

function PlaybookOnlyState({ host, state }: Pick<Props, "host" | "state">) {
  return <>
    {host?.rows?.length === 0 && <p className={styles.empty}>No open playbook decisions</p>}
    {state === "closed" && <p className={styles.empty}>Playbook decisions are listed while open.</p>}
  </>;
}

function ReviewPagination({ more }: Pick<Props, "more">) {
  if (!more.available && !more.limitReached) return null;
  return <div className={styles.footer}>
    {more.available && <ActionButton disabled={more.loading} onClick={more.load}>Load more reviews</ActionButton>}
    {more.limitReached && <p className={styles.meta}>Page limit reached. Refresh to begin again.</p>}
  </div>;
}

function ReviewList({ inbox, links, now }: { inbox: Props; links: RowLinks; now: string | null }) {
  const { names, search, selected } = links;
  const { rows, error, onRefresh, more } = inbox;
  if (!rows) return <div className={styles.status}><QueryStatus status={error ? "error" : "pending"} error={error} label="review inbox" onRetry={onRefresh} /></div>;
  return <>
    {rows.length === 0 ? <EmptyReviews inbox={inbox} /> : <InboxList label="Review inbox" rows={rows} rowKey={r => r.decisionId}>{r =>
      <InboxRow row={r} selected={selected === r.decisionId} projectName={names.get(r.projectId)} now={now} search={search} />
    }</InboxList>}
    <ReviewPagination more={more} />
  </>;
}

function EmptyReviews({ inbox: { questions, host, state } }: { inbox: Props }) {
  if (questions?.rows?.length) return null;
  if (host && host.rows?.length !== 0) return null;
  return <p className={styles.empty}>{emptyInbox(state, Boolean(questions), Boolean(host))}</p>;
}

function inboxRows({ rows = [], questions, host }: Props) {
  const asked = questions?.rows ?? [];
  const playbooks = host?.rows ?? [];
  return { asked, playbooks, count: rows.length + asked.length + playbooks.length };
}

function useProjectNames() {
  const projects = useProjects();
  return useMemo(() => new Map((projects.data?.view ?? []).map(p => [p.id, p.label])), [projects.data]);
}

/** Left column of reference 03: Open | Resolved segmented control, refresh, and the review rows. */
export function DecisionInbox(inbox: Props) {
  const { state, project, reviewsOffered, questions, className } = inbox;
  const { asked, playbooks, count } = inboxRows(inbox);
  const now = useDecisionClock(inbox.serverTime, inbox.updatedAt);
  const names = useProjectNames();
  const search = new URLSearchParams({ ...(project && { scope: `project:${project}` }), state }).toString();
  const links = (kind: Props["selectedKind"]): RowLinks => ({ names, search, selected: inbox.selectedKind === kind ? inbox.selected : undefined });
  return <section className={[styles.pane, className].filter(Boolean).join(" ")} aria-label="Decision inbox" data-inbox="">
    <InboxHeader inbox={inbox} count={count} />
    <QuestionList asked={asked} questions={questions} links={links("question")} />
    <PlaybookDecisions rows={playbooks} inbox={inbox} links={links("playbook")} />
    {reviewsOffered && <ReviewList inbox={inbox} links={links("review")} now={now} />}
  </section>;
}
