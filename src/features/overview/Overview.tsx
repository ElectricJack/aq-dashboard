import { useState } from "react";
import { Link } from "react-router";
import { adaptOverview, type AttentionView, type OverviewView } from "../../api/adapters/inspection";
import type { Overview as OverviewWire } from "../../api/wire/overview";
import { CircleAlert, CircleCheck, CircleHelp, TriangleAlert, type LucideIcon } from "lucide-react";
import { ATTENTION_ICON, COUNT_ICON, Icon } from "../../components/icons";
import { CountLabel } from "../../components/QueryStatus/CountLabel";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { formatAge, formatElapsed } from "../../components/time/relative";
import { scopeSearch, useScope } from "../../app/scope";
import { FACT_LABEL, subjectPath } from "../../app/subjects";
import { useRead } from "../../app/useRead";
import styles from "./Overview.module.css";
import { RecordedTasks } from "./RecordedTasks";
import { Infrastructure } from "./Infrastructure";
import { useSession } from "../../app/session";

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
  return (
    <li className={styles.attentionRow} data-kind={item.kind}>
      <Icon icon={ATTENTION_ICON[item.kind]} size={28} className={styles.kindIcon} />
      <div className={styles.attentionMain}>
        <span className={styles.rowTitle}>{item.title}</span>
        <span className={styles.meta}>
          {item.project?.label ?? "Installation"} · {item.kind === "unsupported" ? "Unsupported item" : item.kind.replaceAll("_", " ")} · {item.since ? `waiting ${formatElapsed(serverTime, item.since)}` : "waiting age unknown"}
        </span>
        <span className={styles.meta}>{item.reason}</span>
        {item.action && !item.action.allowed && item.action.explanation && (
          <span className={styles.meta}>{item.action.explanation}</span>
        )}
      </div>
      <span className={styles.impact}>{item.impact}</span>
      {path ? (
        <Link className={styles.action} to={{ pathname: path, search }} aria-label={`${label}: ${item.title}`}>
          {label}
        </Link>
      ) : item.kind === "worker_offline" || item.kind === "uncertain_operation" ? (
        <button className={styles.action} type="button" aria-expanded={inspect} aria-label={`${label}: ${item.title}`} onClick={() => setInspect(!inspect)}>{label}</button>
      ) : (
        <span className={styles.meta}>{item.kind === "unsupported" ? "Unsupported item type" : "Inspection unavailable"}</span>
      )}
      {inspect && <dl className={styles.referenceDetails}><dt>Subject</dt><dd>{item.subject.type} · {item.subject.id}</dd><dt>Revision</dt><dd>{item.subject.revision ?? "Unknown"}</dd><dt>Observation</dt><dd>{item.reason}</dd></dl>}
    </li>
  );
}

function Attention({ view, serverTime, complete, search }: {
  view: OverviewView;
  serverTime: string;
  complete: boolean;
  search: string;
}) {
  return (
    <section className={styles.panel} aria-labelledby="attention-heading">
      <h2 id="attention-heading">Needs your attention</h2>
      {!complete && (
        <p className={styles.warning}>Attention may be incomplete.</p>
      )}
      {view.attention.length > 0 ? (
        <ul className={styles.attentionList}>
          {view.attention.map((a) => (
            <AttentionRow key={a.id} item={a} serverTime={serverTime} search={search} />
          ))}
        </ul>
      ) : (
        complete && <p className={styles.empty}>Nothing needs your attention</p>
      )}
    </section>
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

  if (!query.data && !query.isError) return <QueryStatus status="pending" label="the overview" error={null} onRetry={()=>void query.refetch()} />;
  if (!query.data) {
    return (
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
          <section className={styles.outcomeSection} aria-labelledby="outcomes-heading"><h2 id="outcomes-heading">Recent outcomes</h2><p className={styles.meta}>{query.isError ? "Outcomes unavailable" : "Loading outcomes…"}</p></section>
          </section>
        </div>
        <Infrastructure />
      </div>
    );
  }

  const { view, serverTime, coverage } = query.data;
  const complete = coverage.state === "complete" && !query.isError && view.sources.every(source => source.coverage.state === "complete");
  return (
    <div className={styles.layout}>
      <p className={styles.summary}>Attention: <CountLabel total={view.counts.needs_you} /> need you. {view.inMotion.length} project {view.inMotion.length === 1 ? "summary" : "summaries"} reported.</p>
      {query.isError && (
        <p className={styles.warning} role="status">
          Refresh failed. Showing the last successful read, which may be out of date.
        </p>
      )}
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
              <CountLabel total={view.counts[key]} />
            </strong>{" "}
            <span>{label}</span>
          </li>
        ))}
      </ul>
      {coverage.reason && view.sources.length === 0 && <details className={styles.coverageDisclosure}><summary>Partial overview</summary><p>{coverage.reason}</p></details>}
      {view.sources.length > 0 && <details className={styles.coverageDisclosure}><summary>Source coverage</summary><ul className={styles.sourceList}>{view.sources.map((source,index)=><li key={`${source.source}:${source.project?.id??index}`}><strong>{source.source.replaceAll('_',' ')}</strong> · {source.coverage.state} · <CountLabel total={source.total} /> records · {source.observation ? formatAge(serverTime,source.observation.observed_at) : 'Observation unavailable'}{source.project && ` · ${source.project.label}`}{source.coverage.reason && <span>{source.coverage.reason.replaceAll('_',' ')}</span>}</li>)}</ul></details>}
      <div className={styles.columns}><div className={styles.primary}>
      <Attention view={view} serverTime={serverTime} complete={complete} search={search} />
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
                  <th scope="row" className={styles.motionProject}>{m.project.label}</th>
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
        {taskContributions && <details className={styles.observationDetails}><summary>Recorded task details</summary><RecordedTasks embedded /></details>}
      <section className={styles.outcomeSection} aria-labelledby="outcomes-heading">
        <h2 id="outcomes-heading">Recent outcomes</h2>
        {view.recentOutcomes.length === 0 ? (
          <p className={styles.meta}>{complete ? "No recent outcomes" : "Outcomes may be incomplete"}</p>
        ) : (
          <ul className={styles.outcomes}>
            {view.recentOutcomes.map((r) => {
              const path = subjectPath(r.subject);
              return (
                <li key={`${r.subject.id}:${r.outcome}`}>
                  <Icon icon={r.outcome === "process_failed" ? TriangleAlert : CircleCheck} size={20} className={r.outcome === "process_failed" ? styles.kindIcon : styles.outcomeIcon} />
                  {path ? <Link to={{ pathname: path, search }}>{r.subject.title}</Link> : <span>{r.subject.title}</span>}
                  <span className={styles.meta}>
                    {FACT_LABEL[r.outcome] ?? "Unsupported outcome"} · {r.project.label} · {formatAge(serverTime, r.at)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      </section>
      </div><Infrastructure /></div>
    </div>
  );
}
