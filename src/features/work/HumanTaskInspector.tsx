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
import { useMediaQuery } from "../../components/useMediaQuery";
import { TaskComments } from "./inspector/TaskComments";
import { IdValue, ServerNow } from "./inspector/common";
import { Section } from "./inspector/Section";
import { useSectionOpen } from "./inspector/sections";
import { StatusBadge, TaskStatusSection, endedHolder } from "./inspector/TaskStatus";
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

/** Phones pin only the compact title bar (P1-02); wider layouts pin the whole header. Matches the CSS breakpoint. */
export const COMPACT_HEADER_QUERY = "(max-width: 600px)";

/**
 * The sticky header's offset (the shell's own sticky top bar, when it has one at this width), and the scroll margin
 * that keeps a focused or scrolled-to control clear of everything pinned above it (P1-04). The document's
 * `scroll-padding-top` already clears the shell bar, so the margin adds only what the inspector pins below it.
 */
function useStickyTop(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const bar = document.querySelector<HTMLElement>("main#content")?.parentElement?.querySelector<HTMLElement>(":scope > header");
    // The pinned element is the whole header on wide layouts and only its title bar on a phone (the header is then `display: contents`).
    const pinned = () => [...element.querySelectorAll<HTMLElement>("[data-inspector-header],[data-inspector-bar]")].find(e => { const style = getComputedStyle(e); return style.position === "sticky" && style.display !== "contents"; });
    const apply = () => {
      const top = bar && getComputedStyle(bar).position === "sticky" ? bar.offsetHeight : 0;
      element.style.setProperty("--inspector-sticky-top", `${top}px`);
      const padding = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
      const margin = Math.max(0, Math.ceil(top + (pinned()?.offsetHeight ?? 0) + 12 - padding));
      element.style.setProperty("--inspector-scroll-margin", `${margin}px`);
    };
    // Text fields scroll their caret, not their box, into view, which ignores the scroll margin: after any focus
    // change, a control still under the pinned header is scrolled just clear of it.
    let frame = 0;
    const reveal = (event: FocusEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null, header = pinned();
      if (!target || !header || header.contains(target) || target.closest("dialog")) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const box = target.getBoundingClientRect(), edge = header.getBoundingClientRect().bottom;
        if (box.top < edge && box.bottom > 0 && box.height < window.innerHeight - edge) window.scrollBy({ top: box.top - edge - 12 });
      });
    };
    apply();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(apply);
    if (bar) observer?.observe(bar);
    element.querySelectorAll("[data-inspector-header],[data-inspector-bar]").forEach(e => observer?.observe(e));
    window.addEventListener("resize", apply); element.addEventListener("focusin", reveal);
    return () => { observer?.disconnect(); cancelAnimationFrame(frame); window.removeEventListener("resize", apply); element.removeEventListener("focusin", reveal); };
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
  const attempts = history.data?.pages[0]?.data.attempts, attemptCount = attempts?.length;
  const w = work.data?.data, parent = w?.parent, ended = endedHolder(w, attempts);
  const compact = useMediaQuery(COMPACT_HEADER_QUERY);
  const linkSearch = listSearch(search);
  const facts = w ? { holding: !!w.execution, blockers: w.blockers.length, complete: w.complete, blockerIds: w.blockers.map(b => b.id), ...(attemptCount !== undefined ? { attempts: attemptCount } : {}) } : undefined;
  const link = typeof window === "undefined" ? "" : `${window.location.origin}/work/${encodeURIComponent(n.id)}?${new URLSearchParams({ scope: `project:${project}` })}`;
  return <ServerNow serverTime={record.observed_at}>
    <section ref={root} className={classes(styles.inspector, className)} aria-labelledby={titleId} data-task-inspector="" data-focused={focused || undefined}>
      {/* Wide layouts pin this whole block. On a phone it lays out as if absent, and only the title bar (title,
          status, one action menu) is pinned, so the sections keep most of the screen (P1-02). */}
      <div className={styles.header} data-inspector-header="">
        <div className={styles.headTop}>
          <BackToTasks search={search} />
          <nav aria-label="Task location" className={styles.crumbs}>
            <span>{record.project.name}</span>
            {parent && <><ChevronRight size={14} aria-hidden /><Link to={{ pathname: `/work/${encodeURIComponent(parent.id)}`, search }} data-parent-link="">{parent.title ?? `Parent task ${parent.id.slice(0, 8)}`}</Link></>}
          </nav>
          {onFocus && <button type="button" className={styles.expand} aria-pressed={focused} onClick={() => onFocus(!focused)} title={focused ? "Restore the list (Esc)" : "Give the task the full width"}>
            {focused ? <Minimize2 size={16} aria-hidden /> : <Maximize2 size={16} aria-hidden />}{focused ? "Collapse" : "Expand"}
          </button>}
        </div>
        <header className={styles.bar} data-inspector-bar="">
          <div className={styles.titleRow}>
            <h2 id={titleId} data-inspector-title="" title={n.title}>{n.title}</h2>
            <div className={styles.actions}><RecordActions record={record} variant={compact ? "menu" : "compact"} execution={facts} /></div>
          </div>
          <StatusBadge work={w} lifecycle={n.task_state} ended={ended} />
        </header>
        <div className={styles.identity}>
          <p className={styles.taskId}><span className="visually-hidden">Task ID </span><IdValue id={n.id} label="task ID" full /></p>
          {link && <span className={styles.copyLink}><CopyValue value={link} label="task link" icon={Link2} /></span>}
          {(n.retired || n.deleted) && <p className={styles.meta}>Record lifecycle: {n.deleted ? "Deleted" : "Retired"}</p>}
          {n.labels.length > 0 && <ul className={styles.labels} aria-label="Labels" title={n.labels.join(", ")}>{n.labels.map(l => <li key={l}>{l}</li>)}</ul>}
        </div>
      </div>
      {notice}
      <Section id="status" title="Status"><TaskStatusSection query={work} search={search} linkSearch={linkSearch} ended={ended} /></Section>
      {/* Comments come straight after Status: the part the owner reads most stays on the first screen (spec 0004 §3, P1-03). */}
      <Section id="comments" title="Comments" summary={commentCount}><TaskComments project={project} task={n.id} query={comments} linkSearch={linkSearch} /></Section>
      <Section id="description" title="Description"><Description body={n.body} /></Section>
      <Section id="acceptance" title="Acceptance criteria">{n.acceptance_criteria ? <DocumentBody body={n.acceptance_criteria} /> : <p className={styles.meta}>No acceptance criteria recorded.</p>}</Section>
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
