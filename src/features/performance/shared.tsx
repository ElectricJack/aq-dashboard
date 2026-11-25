import { useId, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { PERFORMANCE_PATH } from "../../api/adapters/performance";
import { isMissingResource } from "../../api/client";
import type { Scope } from "../../api/wire/proposed";
import { scopeSearch } from "../../app/scope";
import { PANEL_READ } from "../../app/session";
import { useRead, type Read } from "../../app/useRead";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { RetainedNotice } from "../../components/QueryStatus/RetainedNotice";
import styles from "./Performance.module.css";

export function usePerformance<T>(resource: string, adapt: (data: unknown) => T, scope?: Scope, options: {
  path?: string;
  cutoff?: number;
  cursor?: string;
} = {}) {
  return useRead({
    resource: `performance-${resource}`, path: `${PERFORMANCE_PATH}/${options.path ?? resource}`,
    scope, scopeParameter: "project_id", adapt, meta: PANEL_READ,
    params: { cutoff_ms: options.cutoff, cursor: options.cursor },
  });
}

export function ReadPanel<T>({ query, label, children }: {
  query: { data?: Read<T>; isError: boolean; status: "pending" | "error" | "success"; error: unknown; dataUpdatedAt: number; refetch(): unknown };
  label: string;
  children(read: Read<T>): ReactNode;
}) {
  if (!query.data || (query.isError && isMissingResource(query.error))) {
    return <QueryStatus status={query.isError ? "error" : "pending"} label={label} error={query.error}
      onRetry={() => void query.refetch()} retryLabel={label} />;
  }
  return <>
    <RetainedNotice query={query} />
    {query.data.coverage.state !== "complete" && <p className={styles.notice}>
      Report coverage is incomplete.
    </p>}
    {children(query.data)}
  </>;
}

export function Panel({ title, children, detail }: { title: string; children: ReactNode; detail?: string }) {
  const titleId = useId();
  return <section className={styles.panel} aria-labelledby={titleId}>
    <header className={styles.heading}><h2 id={titleId}>{title}</h2>{detail && <span>{detail}</span>}</header>
    {children}
  </section>;
}

export function Details({ summary, children }: { summary: string; children(): ReactNode }) {
  const [opened, setOpened] = useState(false);
  return <details onToggle={event => setOpened(event.currentTarget.open)}>
    <summary>{summary}</summary>
    {opened && children()}
  </details>;
}

export function UnavailableNotice({ reason }: { reason: string }) {
  return <p className={styles.notice}>Temporarily unavailable.{reason !== "source_unavailable" && ` ${reason}`}</p>;
}

export function Table({ label, headings, children }: { label: string; headings: string[]; children: ReactNode }) {
  return <div className={styles.tableScroll} role="region" aria-label={label} tabIndex={0}>
    <table aria-label={label}>
      <thead><tr>{headings.map(heading => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
      <tbody>{children}</tbody>
    </table>
  </div>;
}

const numbers = new Intl.NumberFormat();
const percentage = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 1 });
const utc = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

export const count = (value: number | null) => value == null ? "Unknown" : numbers.format(value);
export const percent = (value: number | null) => value == null ? "Unknown" : percentage.format(value);
export const time = (value: number | null) => value == null ? "Unknown" : `${utc.format(value)} UTC`;
export const labelOf = (value: string) => value.replaceAll("_", " ");

export function duration(ms: number | null): string {
  if (ms == null) return "Unknown";
  if (ms < 1000) return `${count(ms)} ms`;
  if (ms < 60_000) return `${count(Math.round(ms / 1000))} s`;
  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${count(hours)} h ${minutes % 60} min`;
  const seconds = Math.floor(ms / 1000) % 60;
  return `${minutes} min${seconds ? ` ${seconds} s` : ""}`;
}

export function TaskLink({ task, scope, usage = false, children }: {
  task: string; scope?: Scope; usage?: boolean; children?: ReactNode;
}) {
  return <Link className={styles.link} aria-label={children ? undefined : `Task ${task}`} title={children ? undefined : task}
    to={{ pathname: `/${usage ? "performance/tasks" : "work"}/${encodeURIComponent(task)}`, search: scope ? scopeSearch(scope) : "" }}>
    {children ?? `…${task.slice(-8)}`}
  </Link>;
}
