import { Link } from "react-router";
import { adaptOverview, type AttentionView, type OverviewView } from "../../api/adapters/inspection";
import type { Overview as OverviewWire } from "../../api/wire/proposed";
import { CountLabel } from "../../components/QueryStatus/CountLabel";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { formatAge, formatElapsed } from "../../components/time/relative";
import { scopeSearch, useScope } from "../../app/scope";
import { FACT_LABEL, subjectPath } from "../../app/subjects";
import { useRead } from "../../app/useRead";
import styles from "./Overview.module.css";

/** Initial foreground budget from docs/plans/0001 §2. */
const OVERVIEW_POLL_MS = 10_000;

const ACTION_LABEL: Record<AttentionView["kind"], string> = {
  decision: "Review",
  blocked: "Inspect",
  failed: "Inspect",
  uncertain_operation: "Reconcile",
  unsupported: "Open",
};

function AttentionRow({ item, serverTime, search }: { item: AttentionView; serverTime: string; search: string }) {
  const path = subjectPath(item.subject);
  const label = ACTION_LABEL[item.kind];
  return (
    <li className={styles.attentionRow} data-kind={item.kind}>
      <div className={styles.attentionMain}>
        <span className={styles.rowTitle}>{item.title}</span>
        <span className={styles.meta}>
          {item.project.label} · {item.kind === "unsupported" ? "Unsupported item" : item.reason} · waiting{" "}
          {formatElapsed(serverTime, item.since)}
        </span>
        {item.action && !item.action.allowed && item.action.explanation && (
          <span className={styles.meta}>{item.action.explanation}</span>
        )}
      </div>
      <span className={styles.impact}>{item.impact}</span>
      {path ? (
        <Link className={styles.action} to={{ pathname: path, search }} aria-label={`${label}: ${item.title}`}>
          {label}
        </Link>
      ) : (
        <span className={styles.meta}>No view for this item yet</span>
      )}
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
        <p className={styles.warning}>Some projects didn't respond, so this list may be incomplete.</p>
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
  const search = scopeSearch(scope);
  const query = useRead<OverviewWire, OverviewView>({
    resource: "overview",
    path: "/api/v1/overview",
    scope,
    adapt: adaptOverview,
    pollMs: OVERVIEW_POLL_MS,
  });

  if (!query.data) {
    return (
      <QueryStatus
        status={query.isError ? "error" : "pending"}
        error={query.error}
        label="the overview"
        onRetry={() => void query.refetch()}
      />
    );
  }

  const { view, serverTime, coverage } = query.data;
  const complete = coverage.state === "complete";
  return (
    <div className={styles.layout}>
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
          <li key={key}>
            <strong>
              <CountLabel total={view.counts[key]} />
            </strong>{" "}
            <span>{label}</span>
          </li>
        ))}
      </ul>
      <Attention view={view} serverTime={serverTime} complete={complete} search={search} />
      <section className={styles.panel} aria-labelledby="motion-heading">
        <h2 id="motion-heading">Work in motion</h2>
        {/* Scrolls on its own at narrow widths; focusable so keyboard users can scroll it. */}
        <div className={styles.tableWrap} role="region" aria-label="Work in motion, scrollable" tabIndex={0}>
          <table aria-labelledby="motion-heading" className={styles.table}>
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
                <tr key={m.project.id}>
                  <th scope="row">{m.project.label}</th>
                  <td>
                    <CountLabel total={m.running} /> running
                  </td>
                  <td>{m.nextConstraint ? m.nextConstraint.explanation : "None"}</td>
                  <td>{m.lastProgressAt ? formatAge(serverTime, m.lastProgressAt) : "Unknown"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className={styles.panel} aria-labelledby="outcomes-heading">
        <h2 id="outcomes-heading">Recent outcomes</h2>
        {view.recentOutcomes.length === 0 ? (
          <p className={styles.meta}>{complete ? "No recent outcomes" : "Outcomes may be incomplete"}</p>
        ) : (
          <ul className={styles.outcomes}>
            {view.recentOutcomes.map((r) => {
              const path = subjectPath(r.subject);
              return (
                <li key={`${r.subject.id}:${r.outcome}`}>
                  {path ? <Link to={{ pathname: path, search }}>{r.subject.title}</Link> : <span>{r.subject.title}</span>}
                  <span className={styles.meta}>
                    {FACT_LABEL[r.outcome]} · {r.project.label} · {formatAge(serverTime, r.at)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
