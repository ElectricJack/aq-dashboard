import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { adaptOverview, type AttentionView, type OverviewView, type TotalView } from "../../api/adapters/inspection";
import type { Overview as OverviewWire } from "../../api/wire/overview";
import { ArrowRight, CircleAlert, CircleCheck, CircleHelp, TriangleAlert, type LucideIcon } from "lucide-react";
import { ATTENTION_ICON, COUNT_ICON, Icon } from "../../components/icons";
import { CountLabel } from "../../components/QueryStatus/CountLabel";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { formatAge, formatElapsed } from "../../components/time/relative";
import { ApiError } from "../../api/client";
import { scopeSearch, useScope } from "../../app/scope";
import { FACT_LABEL, subjectPath } from "../../app/subjects";
import { useRead } from "../../app/useRead";
import { RetainedNotice } from "../../components/QueryStatus/RetainedNotice";
import styles from "./Overview.module.css";
import { SelectedProjectControl } from "./SelectedProjectControl";
import { RecordedTasks } from "./RecordedTasks";
import { Infrastructure } from "./Infrastructure";
import { useSession } from "../../app/session";
import { PageTitle } from "../../app/DestinationPage";
import { CreateTaskAction } from "../work/CreateTask";

/** Initial foreground budget from docs/plans/0001 §2. */
const OVERVIEW_POLL_MS = 10_000;

const ACTION_LABEL: Record<AttentionView["kind"], string> = {
  decision: "Review",
  question: "Answer",
  worker_offline: "Inspect",
  blocked: "Inspect",
  failed: "Inspect",
  uncertain_operation: "Reconcile",
  unsupported: "Open",
};

/**
 * Recent outcome labels. The server sends `process_<outcome>` for recorded
 * results and `settlement_<disposition>` for settlement evaluations; the shared
 * FACT_LABEL covers the rest. Anything else stays "Unsupported outcome".
 */
const OUTCOME_LABEL: Record<string, string> = {
  ...FACT_LABEL,
  process_success: "Process succeeded",
  process_failed: "Process failed",
  process_cancelled: "Process cancelled",
  process_expired: "Process expired",
  process_unknown: "Process outcome unknown",
  settlement_stale: "Settlement stale",
  settlement_needs_reconciliation: "Settlement needs reconciliation",
};
type OutcomeTone = "success" | "error" | "neutral";
const OUTCOME_TONE: Record<string, OutcomeTone> = {
  process_success: "success",
  settlement_accepted: "success",
  result_accepted: "success",
  task_completed: "success",
  merged: "success",
  deployed: "success",
  candidate_published: "success",
  result_submitted: "success",
  source_retained: "success",
  process_failed: "error",
  settlement_rejected: "error",
};
const OUTCOME_ICON: Record<OutcomeTone, LucideIcon> = { success: CircleCheck, error: TriangleAlert, neutral: CircleHelp };

export function outcomeLabel(outcome: string): string {
  return OUTCOME_LABEL[outcome] ?? "Unsupported outcome";
}

/** Short, stable reference for links that share a server title (WCAG 2.4.4). */
function shortRef(ref: { id: string; revision?: string | null }): string {
  const revision = ref.revision?.replace(/^sha256:/, "");
  return revision && /^[0-9a-f]{12,}$/i.test(revision) ? revision.slice(0, 7) : ref.id.slice(0, 8);
}

/**
 * The server may report one offline worker once per project it ran attempts for.
 * A worker is installation-wide, so keep one row per worker.
 */
export function dedupeAttention(items: readonly AttentionView[]): AttentionView[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (item.kind !== "worker_offline") return true;
    const key = `${item.subject.type}:${item.subject.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

type ConstraintTone = "attention" | "error" | "success" | "unknown";

/**
 * Server constraint kinds are open strings; only recognised kinds get a status
 * tone. Anything else stays neutral so the page never implies a status the
 * server did not report. A null constraint is "Not reported", not "None".
 */
const CONSTRAINT_TONE: Record<string, ConstraintTone> = {
  decision: "attention",
  question: "attention",
  review: "attention",
  approval: "attention",
  waiting: "attention",
  needs_decision: "attention",
  failure: "error",
  failed: "error",
  blocked: "error",
  conflict: "error",
  error: "error",
  none: "success",
  clear: "success",
};

const CONSTRAINT_ICON: Record<ConstraintTone, LucideIcon> = {
  attention: CircleAlert,
  error: CircleAlert,
  success: CircleCheck,
  unknown: CircleHelp,
};

function ConstraintStatus({ constraint }: { constraint: OverviewView["inMotion"][number]["nextConstraint"] }) {
  const tone: ConstraintTone = constraint ? CONSTRAINT_TONE[constraint.kind] ?? "unknown" : "unknown";
  return (
    <span className={styles.constraint} data-tone={tone}>
      <Icon icon={CONSTRAINT_ICON[tone]} size={20} className={styles.constraintIcon} />
      <span>{constraint ? constraint.explanation : "Not reported"}</span>
    </span>
  );
}

function AttentionRow({ item, serverTime, search }: { item: AttentionView; serverTime: string; search: string }) {
  const [inspect, setInspect] = useState(false);
  const path = item.kind === "unsupported" ? null : subjectPath(item.subject);
  const label = ACTION_LABEL[item.kind];
  const age = item.since ? `waiting ${formatElapsed(serverTime, item.since)}` : "waiting age unknown";
  const worker = item.kind === "worker_offline";
  // Workers are installation-wide; a project association is not ownership.
  const where = worker ? "Installation-wide" : item.project?.label ?? "Installation";
  const name = worker ? `${item.title}, worker ${shortRef({ id: item.subject.id })}` : item.title;
  const secondary = [
    where,
    worker ? `worker ${shortRef({ id: item.subject.id })}` : null,
    age,
    item.reason,
    item.action && !item.action.allowed ? item.action.explanation : null,
  ].filter(Boolean).join(" · ");
  const actionContent = <>{label}<Icon icon={ArrowRight} size={16} className={styles.actionArrow} /></>;
  return (
    <li className={styles.attentionRow} data-attention-row="" data-kind={item.kind}>
      <Icon icon={ATTENTION_ICON[item.kind]} size={28} className={styles.kindIcon} />
      <div className={styles.attentionMain}>
        <span className={styles.rowTitle}>{item.title}</span>
        <span className={styles.rowSecondary} title={secondary}>{secondary}</span>
      </div>
      <span className={styles.impact}>{item.impact}</span>
      {path ? (
        <Link className={styles.action} to={{ pathname: path, search }} aria-label={`${label}: ${name}`}>
          {actionContent}
        </Link>
      ) : item.kind === "worker_offline" || item.kind === "uncertain_operation" ? (
        <button className={styles.action} type="button" aria-expanded={inspect} aria-label={`${label}: ${name}`} onClick={() => setInspect(!inspect)}>{actionContent}</button>
      ) : (
        <span className={styles.meta}>{item.kind === "unsupported" ? "Unsupported item type" : "Inspection unavailable"}</span>
      )}
      {inspect && <dl className={styles.referenceDetails}><dt>Subject</dt><dd>{item.subject.type} · {item.subject.id}</dd><dt>Revision</dt><dd>{item.subject.revision ?? "Unknown"}</dd><dt>Observation</dt><dd>{item.reason}</dd></dl>}
    </li>
  );
}

type NeedsYou = TotalView & { atLeast?: boolean };

/**
 * The needs-you total never claims fewer items than the attention list shows.
 * When the server total is lower or unknown, the shown rows are a lower bound.
 */
export function reconcileNeedsYou(total: TotalView, shown: number): NeedsYou {
  if (shown > 0 && (total.value === null || shown > total.value)) return { value: shown, accuracy: "estimated", atLeast: true };
  return total;
}

function NeedsYouCount({ total }: { total: NeedsYou }) {
  if (total.atLeast) return <span aria-label={`at least ${total.value}`}>{total.value}+</span>;
  return <CountLabel total={total} />;
}

/** Plain-language attention count: estimated counts say "About", unknown never reads as zero. */
export function attentionSentence(total: NeedsYou): string {
  if (total.atLeast) return `At least ${total.value} ${total.value === 1 ? "item needs" : "items need"} you.`;
  // needs_you counts every attention item (decisions, offline workers, failed results...), so say "items" (RR-02).
  if (total.value === null) return "The number of items that need you is unknown.";
  const n = total.value;
  if (n === 0) return total.accuracy === "estimated" ? "Few or no items need you." : "No items need you.";
  const phrase = `${n} ${n === 1 ? "item needs" : "items need"} you.`;
  return total.accuracy === "estimated" ? `About ${phrase}` : phrase;
}

/** "Moving" means a reported running count above zero, not merely a listed project. */
export function motionSentence(inMotion: OverviewView["inMotion"], complete: boolean): string {
  const projects = inMotion.filter((m) => (m.running.value ?? 0) > 0).length;
  if (projects > 0) return `Work is moving in ${projects} ${projects === 1 ? "project" : "projects"}.`;
  if (inMotion.some((m) => m.running.value === null)) return "Project movement is not reported.";
  if (inMotion.length > 0) return "No work is running.";
  return complete ? "No work is in motion." : "Project movement is not reported.";
}

/** Title and summary on the left, the primary Create task action on the right (reference 01). */
function OverviewHeader({ children, action = true }: { children: ReactNode; action?: boolean }) {
  const { bootstrap } = useSession();
  return (<>
    <div className={styles.header}>
      <div className={styles.titleBlock}>
        <PageTitle>Overview</PageTitle>
        <p className={styles.summary} data-testid="overview-summary">{children}</p>
      </div>
      {action && bootstrap.capability("tasks.create").enabled && (
        <div className={styles.headerAction}>
          <CreateTaskAction />
        </div>
      )}
    </div>
    {action && <SelectedProjectControl />}
  </>);
}

function Attention({ view, attention, total, serverTime, complete, search }: {
  view: OverviewView;
  attention: AttentionView[];
  total: NeedsYou;
  serverTime: string;
  complete: boolean;
  search: string;
}) {
  const workers = view.sources.find((source) => source.source === "workers");
  const partialWorkers = attention.some((a) => a.kind === "worker_offline") && workers !== undefined && workers.coverage.state !== "complete";
  return (
    <section className={styles.panel} aria-labelledby="attention-heading">
      <div className={styles.panelHeading}>
        <h2 id="attention-heading">Needs your attention</h2>
        <Link className={styles.viewAll} to={{ pathname: "/decisions", search }}>
          View all{total.value !== null && <> <NeedsYouCount total={total} /></>}
          <Icon icon={ArrowRight} size={16} />
        </Link>
      </div>
      {!complete && (
        <p className={styles.warning}>Attention may be incomplete.</p>
      )}
      {attention.length > 0 ? (
        <ul className={styles.attentionList}>
          {attention.map((a) => (
            <AttentionRow key={a.id} item={a} serverTime={serverTime} search={search} />
          ))}
        </ul>
      ) : (
        complete && <p className={styles.empty}>Nothing needs your attention</p>
      )}
      {partialWorkers && (
        <p className={styles.meta}>Offline workers are listed here only when the server can relate them to recorded work. Capacity › More capacity › Worker nodes shows every heartbeat.</p>
      )}
    </section>
  );
}

/** A project-scoped read the server refuses as invalid or unknown (not a transient failure). */
function unavailableProject(scopeKind: string, error: unknown): boolean {
  return scopeKind === "project" && error instanceof ApiError && [400, 404, 422].includes(error.status ?? 0);
}

function ProjectUnavailable() {
  return (
    <div className={styles.layout}>
      <OverviewHeader action={false}>This project is not available.</OverviewHeader>
      <section className={styles.panel} aria-labelledby="project-unavailable-heading">
        <h2 id="project-unavailable-heading">Project not available</h2>
        <p>This project does not exist or is not available to you.</p>
        <Link to={{ pathname: "/overview" }}>Show all projects →</Link>
      </section>
    </div>
  );
}

export function Overview() {
  const [scope] = useScope();
  const { bootstrap } = useSession();
  const taskContributions = bootstrap.capability("human.overview.tasks.read").enabled;
  const search = scopeSearch(scope);
  const query = useRead<OverviewWire, OverviewView>({
    resource: "overview",
    path: "/api/v1/overview",
    scope,
    adapt: adaptOverview,
    pollMs: OVERVIEW_POLL_MS,
  });

  if (!query.data && unavailableProject(scope.kind, query.error)) return <ProjectUnavailable />;
  if (!query.data && !query.isError) return (
    <div className={styles.layout}>
      <OverviewHeader>Checking what needs you…</OverviewHeader>
      <QueryStatus status="pending" label="the overview" error={null} onRetry={()=>void query.refetch()} />
    </div>
  );
  if (!query.data) {
    return (
      <div className={styles.layout}>
      <OverviewHeader>The overview summary is unavailable.</OverviewHeader>
      <div className={styles.columns}>
        <div className={styles.primary}>
          <section className={styles.panel} aria-labelledby="attention-heading">
          <h2 id="attention-heading">Needs your attention</h2>
          <QueryStatus status={query.isError ? "error" : "pending"} error={query.error} label="the overview" onRetry={() => void query.refetch()} />
          </section>
          <section className={styles.panel} aria-labelledby="motion-heading">
          <h2 id="motion-heading">Work in motion</h2>
          <p className={styles.meta}>{query.isError ? "Project movement unavailable" : "Loading project movement…"}</p>
          {query.isError && <RecordedTasks />}
          <section className={styles.outcomeSection} aria-labelledby="outcomes-heading"><h2 id="outcomes-heading">Recent outcomes</h2><p className={styles.meta}>{query.isError ? "Outcomes unavailable" : "Loading outcomes…"}</p><Link className={styles.footerLink} to={{ pathname: "/results", search }}>Activity →</Link></section>
          </section>
        </div>
        <Infrastructure />
      </div>
      </div>
    );
  }

  const { view, serverTime, coverage } = query.data;
  const complete = coverage.state === "complete" && !query.isError && view.sources.every(source => source.coverage.state === "complete");
  const attention = dedupeAttention(view.attention);
  const needsYou = reconcileNeedsYou(view.counts.needs_you, attention.length);
  const canOpenWork = bootstrap.capability("tasks.read").enabled;
  return (
    <div className={styles.layout}>
      <OverviewHeader>{attentionSentence(needsYou)} {motionSentence(view.inMotion, complete)}</OverviewHeader>
      {/* SO-13: a failed refresh or an offline browser marks the kept read with its age. */}
      <RetainedNotice query={query} className={styles.warning} />
      <ul className={styles.counts} aria-label="Work counts">
        {(
          [
            ["running", "running"],
            ["ready", "ready"],
            ["needs_you", "need you"],
            ["recovering", "recovering"],
          ] as const
        ).map(([key, label]) => (
          <li key={key} data-count={key}>
            <Icon icon={COUNT_ICON[key]} size={24} className={styles.countIcon} />
            <strong>
              {key === "needs_you" ? <NeedsYouCount total={needsYou} /> : <CountLabel total={view.counts[key]} />}
            </strong>{" "}
            <span>{label}</span>
          </li>
        ))}
      </ul>
      {(coverage.state !== "complete" || view.sources.some(source => source.coverage.state !== "complete")) && (
        <p className={styles.warning} role="status">
          Some overview information is unavailable or incomplete. Counts and lists may be incomplete.{" "}
          <Link to={{ pathname: "/settings", search, hash: "#overview-diagnostics" }}>View diagnostics</Link>
        </p>
      )}
      <div className={styles.columns}><div className={styles.primary}>
      <Attention view={view} attention={attention} total={needsYou} serverTime={serverTime} complete={complete} search={search} />
      <section className={styles.panel} aria-labelledby="motion-heading">
        <h2 id="motion-heading">Work in motion</h2>
        {<div className={styles.tableWrap} role="region" aria-label="Work in motion, scrollable" tabIndex={0}>
          <table aria-labelledby="motion-heading" className={`${styles.table} ${styles.motionTable}`}>
            <thead>
              <tr>
                <th scope="col">Project</th>
                <th scope="col">Now</th>
                <th scope="col">Next constraint</th>
                <th scope="col">Last progress</th>
              </tr>
            </thead>
            <tbody>
              {view.inMotion.map((m) => (
                <tr key={m.project.id} className={styles.motionRow}>
                  <th scope="row" className={styles.motionProject}>
                    {canOpenWork ? (
                      <Link to={{ pathname: "/work", search: scopeSearch({ kind: "project", project_id: m.project.id }) }}>{m.project.label}</Link>
                    ) : m.project.label}
                  </th>
                  <td className={styles.motionNow}>
                    <CountLabel total={m.running} /> running
                  </td>
                  <td className={styles.motionConstraint}><ConstraintStatus constraint={m.nextConstraint} /></td>
                  <td className={styles.motionProgress}>{m.lastProgressAt ? formatAge(serverTime, m.lastProgressAt) : "Unknown"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>}
        {view.inMotion.length === 0 && <p className={styles.meta}>{complete ? "No work in motion" : "Project movement not reported"}</p>}
        {taskContributions && <details className={styles.observationDetails}><summary>Recorded task details</summary><RecordedTasks embedded serverTime={serverTime} /></details>}
      <section className={styles.outcomeSection} aria-labelledby="outcomes-heading">
        <h2 id="outcomes-heading">Recent outcomes</h2>
        {view.recentOutcomes.length === 0 ? (
          <p className={styles.meta}>{complete ? "No recent outcomes" : "Outcomes may be incomplete"}</p>
        ) : (
          <ul className={styles.outcomes}>
            {view.recentOutcomes.map((r) => {
              const path = subjectPath(r.subject);
              const tone = OUTCOME_TONE[r.outcome] ?? "neutral";
              const label = outcomeLabel(r.outcome);
              const age = formatAge(serverTime, r.at);
              return (
                <li key={`${r.subject.id}:${r.outcome}`} data-outcome-tone={tone}>
                  <Icon icon={OUTCOME_ICON[tone]} size={20} className={styles.outcomeIcon} />
                  {path ? (
                    <Link to={{ pathname: path, search }} aria-label={`${r.subject.title} ${shortRef(r.subject)}, ${label}, ${age}`}>
                      {r.subject.title} <span className={styles.meta}>{shortRef(r.subject)}</span>
                    </Link>
                  ) : <span>{r.subject.title}</span>}
                  <span className={styles.meta}>
                    {label} · {r.project.label} · {age}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <Link className={styles.footerLink} to={{ pathname: "/results", search }}>Activity →</Link>
      </section>
      </section>
      </div><Infrastructure serverTime={serverTime} /></div>
    </div>
  );
}
