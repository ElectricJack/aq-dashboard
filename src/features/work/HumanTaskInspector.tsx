import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ArrowLeft, ChevronRight, Link2, Maximize2, Minimize2 } from "lucide-react";
import { RecordActions } from "../actions/RecordActions";
import { type GraphEnvelope, type GraphNode } from "../../api/adapters/humanGraph";
import { useDocumentTitle } from "../../app/documentTitle";
import { formatAge } from "../../components/time/relative";
import { DocumentBody } from "../knowledge/DocumentBody";
import { RecordFacts } from "../knowledge/KnowledgeDocument";
import { CopyValue } from "../decisions/DecisionContext";
import { useTaskComments, useTaskHistory, useTaskWork } from "./taskWork";
import { useSession } from "../../app/session";
import { TaskComments } from "./inspector/TaskComments";
import { IdValue, ServerNow } from "./inspector/common";
import { Section } from "./inspector/Section";
import { useSectionOpen } from "./inspector/sections";
import { StatusBadge, TaskStatusSection } from "./inspector/TaskStatus";
import { TaskAttempts } from "./inspector/TaskAttempts";
import { TaskHistory } from "./inspector/TaskHistory";
import { TaskHierarchy } from "./inspector/TaskHierarchy";
import { TaskResults } from "./inspector/TaskResults";
import styles from "./HumanTaskInspector.module.css";
import parts from "./inspector/Inspector.module.css";

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

/** The sticky header's offset: the shell's own sticky top bar, when it has one at this width. */
function useStickyTop(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = ref.current, bar = document.querySelector<HTMLElement>("main#content")?.parentElement?.querySelector<HTMLElement>(":scope > header");
    if (!element || !bar) return;
    const apply = () => element.style.setProperty("--inspector-sticky-top", getComputedStyle(bar).position === "sticky" ? `${bar.offsetHeight}px` : "0px");
    apply();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(apply);
    observer?.observe(bar); window.addEventListener("resize", apply);
    return () => { observer?.disconnect(); window.removeEventListener("resize", apply); };
  }, [ref]);
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
  const work = useTaskWork(project, n.id);
  const [attemptsOpen] = useSectionOpen("attempts"), [historyOpen] = useSectionOpen("history"), [commentsOpen] = useSectionOpen("comments");
  const { bootstrap } = useSession();
  const comments = useTaskComments(project, n.id, commentsOpen && bootstrap.capability("tasks.comments.read").enabled);
  const commentCount = comments.data ? `${comments.data.pages.reduce((total, p) => total + p.data.items.length, 0)}${comments.hasNextPage ? "+" : ""}` : undefined;
  // One history read serves Attempts, History and Retry attempt's precondition (WD-11).
  const retryNeedsAttempts = n.task_state === "active" && !!work.data && !work.data.data.execution;
  const history = useTaskHistory(project, n.id, attemptsOpen || historyOpen || retryNeedsAttempts);
  const attemptCount = history.data?.pages[0]?.data.attempts.length;
  const w = work.data?.data, parent = w?.parent;
  const linkSearch = listSearch(search);
  const facts = w ? { holding: !!w.execution, blockers: w.blockers.length, complete: w.complete, blockerIds: w.blockers.map(b => b.id), ...(attemptCount !== undefined ? { attempts: attemptCount } : {}) } : undefined;
  const link = typeof window === "undefined" ? "" : `${window.location.origin}/work/${encodeURIComponent(n.id)}?${new URLSearchParams({ scope: `project:${project}` })}`;
  return <ServerNow serverTime={record.observed_at}>
    <section ref={root} className={classes(styles.inspector, className)} aria-labelledby={titleId} data-task-inspector="" data-focused={focused || undefined}>
      <header className={styles.header} data-inspector-header="">
        <BackToTasks search={search} />
        <div className={styles.headTop}>
          <nav aria-label="Task location" className={styles.crumbs}>
            <span>{record.project.name}</span>
            {parent && <><ChevronRight size={14} aria-hidden /><Link to={{ pathname: `/work/${encodeURIComponent(parent.id)}`, search }} data-parent-link="">{parent.title ?? `Parent task ${parent.id.slice(0, 8)}`}</Link></>}
          </nav>
          <div className={styles.actions}><RecordActions record={record} variant="compact" execution={facts} /></div>
          {onFocus && <button type="button" className={styles.expand} aria-pressed={focused} onClick={() => onFocus(!focused)} title={focused ? "Restore the list (Esc)" : "Give the task the full width"}>
            {focused ? <Minimize2 size={16} aria-hidden /> : <Maximize2 size={16} aria-hidden />}{focused ? "Collapse" : "Expand"}
          </button>}
        </div>
        <h2 id={titleId} data-inspector-title="">{n.title}</h2>
        <div className={styles.identity}>
          <StatusBadge work={w} lifecycle={n.task_state} />
          <p className={styles.taskId}><span className="visually-hidden">Task ID </span><IdValue id={n.id} label="task ID" full /></p>
          {link && <span className={styles.copyLink}><CopyValue value={link} label="task link" icon={Link2} /></span>}
          {(n.retired || n.deleted) && <p className={styles.meta}>Record lifecycle: {n.deleted ? "Deleted" : "Retired"}</p>}
        </div>
        {n.labels.length > 0 && <ul className={styles.labels} aria-label="Labels">{n.labels.map(l => <li key={l}>{l}</li>)}</ul>}
      </header>
      {notice}
      <Section id="status" title="Status"><TaskStatusSection query={work} search={search} linkSearch={linkSearch} /></Section>
      <Section id="description" title="Description"><Description body={n.body} /></Section>
      <Section id="acceptance" title="Acceptance criteria">{n.acceptance_criteria ? <DocumentBody body={n.acceptance_criteria} /> : <p className={styles.meta}>No acceptance criteria recorded.</p>}</Section>
      <Section id="comments" title="Comments" summary={commentCount}><TaskComments project={project} task={n.id} query={comments} linkSearch={linkSearch} /></Section>
      <Section id="attempts" title="Attempts" summary={attemptCount !== undefined ? `${attemptCount}${history.data?.pages[0]?.data.attempts_truncated ? "+" : ""}` : undefined}><TaskAttempts query={history} linkSearch={linkSearch} /></Section>
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
