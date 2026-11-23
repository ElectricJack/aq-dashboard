import { useId, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ArrowLeft, ChevronRight, Link2, Maximize2, Minimize2 } from "lucide-react";
import { RecordActions, type TaskExecutionFacts } from "../actions/RecordActions";
import { type GraphEnvelope, type GraphNode } from "../../api/adapters/humanGraph";
import { useDocumentTitle } from "../../app/documentTitle";
import { formatAge } from "../../components/time/relative";
import { DocumentBody } from "../knowledge/DocumentBody";
import { RecordFacts } from "../knowledge/KnowledgeDocument";
import { CopyValue } from "../decisions/DecisionContext";
import { type TaskWork, type TaskAttempt, useTaskComments, useTaskHistory, useTaskSummary, useTaskWork } from "./taskWork";
import { useSession } from "../../app/session";
import { useMediaQuery } from "../../components/useMediaQuery";
import { TaskComments } from "./inspector/TaskComments";
import { IdValue, ServerNow } from "./inspector/common";
import { useStickyTop } from "./inspector/useStickyTop";
import { Section } from "./inspector/Section";
import { useSectionOpen } from "./inspector/sections";
import { StatusBadge, TaskStatusSection, endedHolder } from "./inspector/TaskStatus";
import { TaskAttempts } from "./inspector/TaskAttempts";
import { TaskHistory } from "./inspector/TaskHistory";
import { TaskHierarchy } from "./inspector/TaskHierarchy";
import { TaskResults } from "./inspector/TaskResults";
import styles from "./HumanTaskInspector.module.css";
import parts from "./inspector/Inspector.module.css";

/** Attempt statuses before a grant (aq-server `role_settings::granted`). */
const NOT_STARTED = ["offered", "preparing", "declined", "never_granted"];
const classes = (...names: (string | undefined | false)[]) => names.filter(Boolean).join(" ");
/** Links out of the inspector open in list mode: graph view, graph root and Expand are inspector context only. */
export function listSearch(search: string) {
  const params = new URLSearchParams(search);
  params.delete("view"); params.delete("root"); params.delete("focus");
  const value = params.toString();
  return value ? `?${value}` : "";
}
function BackToTasks({ search, always }: { search: string; always?: boolean }) {
  return <Link to={{ pathname: "/work", search: listSearch(search) }} className={classes(styles.back, always && styles.backAlways)}><ArrowLeft size={16} aria-hidden />All tasks</Link>;
}

/** Long descriptions get a bounded preview so Status and Comments stay near the top (spec 0004 §3). */
const LONG_BODY = 800, LONG_LINES = 10;
function Description({ body }: { body: string }) {
  const [all, setAll] = useState(false), id = useId();
  const long = body.length > LONG_BODY || body.split("\n").length > LONG_LINES;
  return <>
    <div id={id} className={classes(long && !all && parts.clamped)}><DocumentBody body={body} /></div>
    {long && <button type="button" className={parts.linkButton} aria-expanded={all} aria-controls={id} onClick={() => setAll(v => !v)}>{all ? "Show less" : "Show full description"}</button>}
  </>;
}

/** Phones pin only the compact title bar (P1-02); wider layouts pin the whole header. Matches the CSS breakpoint. */
export const COMPACT_HEADER_QUERY = "(max-width: 600px)";

function executionFacts(work: TaskWork | undefined, attempts: TaskAttempt[] | undefined): TaskExecutionFacts | undefined {
  if (!work) return undefined;
  const facts: TaskExecutionFacts = {
    holding: !!work.execution, blockers: work.blockers.length, complete: work.complete, blockerIds: work.blockers.map(blocker => blocker.id),
  };
  if (attempts) facts.attempts = attempts.length;
  if (work.routing) facts.routing = work.routing;
  if (work.role) {
    facts.role = work.role;
    // An attempt past being offered or prepared was granted. Its task role is then fixed.
    facts.started = [work.execution, ...(attempts ?? [])].some(attempt => attempt && !NOT_STARTED.includes(attempt.status));
  }
  return facts;
}

function commentSummary(query: ReturnType<typeof useTaskComments>) {
  if (!query.data) return undefined;
  const count = query.data.pages.reduce((total, page) => total + page.data.items.length, 0);
  return `${count}${query.hasNextPage ? "+" : ""}`;
}

function attemptSummary(query: ReturnType<typeof useTaskHistory>) {
  const first = query.data?.pages[0]?.data;
  if (!first) return undefined;
  return `${first.attempts.length}${first.attempts_truncated ? "+" : ""}`;
}

// One history read serves Attempts, History and Retry attempt's precondition (WD-11).
function useAttemptRead(project: string, node: GraphNode, work: ReturnType<typeof useTaskWork>) {
  const [attemptsOpen] = useSectionOpen("attempts"), [historyOpen] = useSectionOpen("history");
  const needsRetry = node.task_state === "active" && !!work.data && !work.data.data.execution;
  return useTaskHistory(project, node.id, attemptsOpen || historyOpen || needsRetry);
}

function useInspectorReads(project: string, n: GraphNode) {
  const work = useTaskWork(project, n.id);
  const [commentsOpen] = useSectionOpen("comments");
  const { bootstrap } = useSession();
  const summary = useTaskSummary(project, n.id, bootstrap.capability("tasks.activate.subtree").enabled && bootstrap.capability("dashboard.actions").enabled);
  const hasDraftDescendants = (summary.data?.data.by_state.draft ?? "0") !== "0";
  const comments = useTaskComments(project, n.id, commentsOpen && bootstrap.capability("tasks.comments.read").enabled);
  const history = useAttemptRead(project, n, work);
  const attempts = history.data?.pages[0]?.data.attempts;
  const w = work.data?.data, ended = endedHolder(w, attempts);
  return { work, w, comments, history, attempts, ended, hasDraftDescendants };
}

function InspectorNavigation({ search, parent, projectName, focused, onFocus }: {
  search: string; parent?: TaskWork["parent"]; projectName: string; focused: boolean; onFocus?: (focused: boolean) => void;
}) {
  return (
    <div className={styles.headTop}>
      <BackToTasks search={search} />
      <nav aria-label="Task location" className={styles.crumbs}>
        <span>{projectName}</span>
        {parent && <><ChevronRight size={14} aria-hidden /><Link to={{ pathname: `/work/${encodeURIComponent(parent.id)}`, search }} data-parent-link="">{parent.title ?? `Parent task ${parent.id.slice(0, 8)}`}</Link></>}
      </nav>
      {onFocus && <button type="button" className={styles.expand} aria-pressed={focused} onClick={() => onFocus(!focused)} title={focused ? "Restore the list (Esc)" : "Give the task the full width"}>
        {focused ? <Minimize2 size={16} aria-hidden /> : <Maximize2 size={16} aria-hidden />}{focused ? "Collapse" : "Expand"}
      </button>}
    </div>
  );
}

function taskLink(record: GraphEnvelope<GraphNode>) {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams({ scope: `project:${record.project.id}` });
  return `${window.location.origin}/work/${encodeURIComponent(record.data.id)}?${params}`;
}

function TaskDescription({ node: n }: { node: GraphNode }) {
  return <>
    <Section id="description" title="Description"><Description body={n.body} /></Section>
    <Section id="acceptance" title="Acceptance criteria">{n.acceptance_criteria ? <DocumentBody body={n.acceptance_criteria} /> : <p className={styles.meta}>No acceptance criteria recorded.</p>}</Section>
  </>;
}

function InspectorIdentity({ node: n, link }: { node: GraphNode; link: string }) {
  return (
    <div className={styles.identity}>
      <p className={styles.taskId}><span className="visually-hidden">Task ID </span><IdValue id={n.id} label="task ID" full /></p>
      {link && <span className={styles.copyLink}><CopyValue value={link} label="task link" icon={Link2} /></span>}
      {(n.retired || n.deleted) && <p className={styles.meta}>Record lifecycle: {n.deleted ? "Deleted" : "Retired"}</p>}
      {n.labels.length > 0 && <ul className={styles.labels} aria-label="Labels" title={n.labels.join(", ")}>{n.labels.map(l => <li key={l}>{l}</li>)}</ul>}
    </div>
  );
}

function Estimate({ points }: { points: GraphNode["story_points"] }) {
  if (points === undefined) return null;
  const label = points === null ? "Unestimated" : `${points} story ${points === 1 ? "point" : "points"}`;
  return <span className={styles.estimate}>{label}</span>;
}

/**
 * Work's task inspector: the single task view (spec 0004 §3; there is no separate full-task page). A sticky
 * header with identity, status and actions, then foldable sections. Sections read only while open, so the
 * inspector issues a handful of reads at a time.
 */
export function HumanTaskInspector({ record, search, notice, className, focused = false, onFocus }: {
  record: GraphEnvelope<GraphNode>; search: string; notice?: ReactNode; className?: string; focused?: boolean; onFocus?: (on: boolean) => void;
}) {
  const n = record.data, project = record.project.id, titleId = useId(), root = useRef<HTMLElement>(null);
  useDocumentTitle(n.title);
  useStickyTop(root);
  const { work, w, comments, history, attempts, ended, hasDraftDescendants } = useInspectorReads(project, n);
  const parent = w?.parent;
  const compact = useMediaQuery(COMPACT_HEADER_QUERY);
  const linkSearch = listSearch(search);
  const facts = executionFacts(w, attempts);
  const link = taskLink(record);
  return <ServerNow serverTime={record.observed_at}>
    <section ref={root} className={classes(styles.inspector, className)} aria-labelledby={titleId} data-task-inspector="" data-focused={focused || undefined}>
      {/* Wide layouts pin this whole block. On a phone it lays out as if absent, and only the title bar (title,
          status, one action menu) is pinned, so the sections keep most of the screen (P1-02). */}
      <div className={styles.header} data-inspector-header="">
        <InspectorNavigation search={search} parent={parent} projectName={record.project.name} focused={focused} onFocus={onFocus} />
        <header className={styles.bar} data-inspector-bar="">
          <div className={styles.titleRow}>
            <h2 id={titleId} data-inspector-title="" title={n.title}>{n.title}</h2>
            <div className={styles.actions}><RecordActions record={record} variant={compact ? "menu" : "compact"} execution={facts} hasDraftDescendants={hasDraftDescendants} /></div>
          </div>
          <div className={styles.statusLine}>
            <StatusBadge work={w} lifecycle={n.task_state} ended={ended} />
            <Estimate points={n.story_points} />
          </div>
        </header>
        <InspectorIdentity node={n} link={link} />
      </div>
      {notice}
      <Section id="status" title="Status">
        <TaskStatusSection query={work} taskId={n.id} search={search} linkSearch={linkSearch} ended={ended} />
        {n.requested_by && <p className={parts.meta} data-task-requester="">Requested by <strong>{n.requested_by.name}</strong> · {n.requested_by.email}</p>}
      </Section>
      {/* Comments come straight after Status: the part the owner reads most stays on the first screen (spec 0004 §3, P1-03). */}
      <Section id="comments" title="Comments" summary={commentSummary(comments)}><TaskComments project={project} task={n.id} query={comments} linkSearch={linkSearch} /></Section>
      <TaskDescription node={n} />
      <Section id="attempts" title="Attempts" summary={attemptSummary(history)}><TaskAttempts query={history} linkSearch={linkSearch} holding={w?.execution} /></Section>
      <Section id="results" title="Results"><TaskResults project={project} task={n.id} /></Section>
      <Section id="hierarchy" title="Dependencies and hierarchy"><TaskHierarchy project={project} node={n} work={w} search={search} /></Section>
      <Section id="history" title="History"><TaskHistory query={history} /></Section>
      <details className={styles.disclosure}><summary>Record details and verification</summary><RecordFacts node={n} /></details>
      <p className={styles.footer}>
        <span>Revision {n.content_revision}</span> · <span>Updated <time dateTime={n.updated_at} title={n.updated_at}>{formatAge(record.observed_at, n.updated_at)}</time></span>
        {" "}· <span>Observed <time dateTime={record.observed_at} title={record.observed_at}>{record.observed_at}</time></span>
      </p>
    </section>
  </ServerNow>;
}

/** A task that cannot be read keeps the inspector's frame and an exit back to the task list. */
export function TaskInspectorUnavailable({ search, className, status, busy }: { search: string; className?: string; status: ReactNode; busy?: boolean }) {
  const titleId = useId();
  // While loading, `aria-busy` also keeps selection focus waiting for the task heading itself.
  return <section className={classes(styles.inspector, className)} aria-labelledby={titleId} aria-busy={busy || undefined}>
    <header className={styles.header}><h2 id={titleId} data-inspector-title="">Task</h2></header>
    {status}
    <BackToTasks search={search} always />
  </section>;
}
