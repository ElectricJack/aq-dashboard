import { useState } from "react";
import { useLocation } from "react-router";
import { adaptOverview, type OverviewView } from "../../api/adapters/inspection";
import type { Overview as OverviewWire } from "../../api/wire/overview";
import { useRead } from "../../app/useRead";
import { useScope } from "../../app/scope";
import { CountLabel } from "../../components/QueryStatus/CountLabel";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { RetainedNotice } from "../../components/QueryStatus/RetainedNotice";
import { formatAge } from "../../components/time/relative";
import styles from "./Settings.module.css";

function SourceCoverage() {
  const [scope] = useScope();
  const query = useRead<OverviewWire, OverviewView>({
    resource: "overview",
    path: "/api/v1/overview",
    scope,
    adapt: adaptOverview,
    pollMs: 10_000,
  });
  if (!query.data) return (
    <QueryStatus status={query.isError ? "error" : "pending"} label="overview diagnostics" error={query.error} onRetry={() => void query.refetch()} />
  );
  const { view, serverTime, coverage } = query.data;
  return (
    <>
      <RetainedNotice query={query} className={styles.meta} />
      <p className={styles.meta}>Source coverage: {coverage.state}. Record counts describe the information read for the overview, not completed work.</p>
      {coverage.reason && <p className={styles.meta}>{coverage.reason}</p>}
      {view.sources.length === 0 ? (
        <p className={styles.meta}>No source details reported.</p>
      ) : (
        <ul className={styles.sources} aria-label="Overview data sources">
          {view.sources.map((source, index) => (
            <li key={`${source.source}:${source.project?.id ?? index}`}>
              <span><strong>{source.source.replaceAll("_", " ")}</strong> · {source.coverage.state} · <CountLabel total={source.total} /> records{source.project && ` · ${source.project.label}`}</span>
              <span className={styles.meta}>{source.observation ? formatAge(serverTime, source.observation.observed_at) : "Observation unavailable"}</span>
              {source.coverage.reason && <span className={styles.meta}>{source.coverage.reason.replaceAll("_", " ")}</span>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function OverviewDiagnostics() {
  const { hash } = useLocation();
  const [open, setOpen] = useState(hash === "#overview-diagnostics");
  return (
    <details id="overview-diagnostics" className={styles.technical} open={open} onToggle={event => setOpen(event.currentTarget.open)}>
      <summary>Overview diagnostics</summary>
      {open && <SourceCoverage />}
    </details>
  );
}
