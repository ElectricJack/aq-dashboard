import { useState } from "react";
import { Link } from "react-router";
import type { AttentionView } from "../../api/adapters/inspection";
import { ATTENTION_SOURCE_LABEL } from "../../api/adapters/overview";
import { ArrowRight, X } from "lucide-react";
import { ATTENTION_ICON, Icon } from "../../components/icons";
import { formatElapsed } from "../../components/time/relative";
import { subjectPath } from "../../app/subjects";
import styles from "./Overview.module.css";
import { dismissible, useDismissAttention, useDismissFailed } from "./useDismissAttention";

const ACTION_LABEL: Record<AttentionView["kind"], string> = {
  decision: "Review",
  question: "Answer",
  worker_offline: "Inspect",
  blocked: "Inspect",
  failed: "Inspect",
  uncertain_operation: "Reconcile",
  internal_work: "Open",
  unsupported: "Open",
};

/** Short, stable reference for links that share a server title (WCAG 2.4.4). */
export function shortRef(ref: { id: string; revision?: string | null }): string {
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

function attentionDestination(item: AttentionView, search: string) {
  if (item.kind === "unsupported") return null;
  const path = subjectPath(item.subject);
  if (!path) return null;
  // A path may carry its own query (History's Internal filter); keep the scope too.
  const [pathname, query] = path.split("?");
  const linkSearch = new URLSearchParams(search);
  new URLSearchParams(query).forEach((value, key) => linkSearch.set(key, value));
  return { pathname, search: linkSearch.size ? `?${linkSearch}` : "" };
}

function attentionDescription(item: AttentionView, serverTime: string) {
  const age = item.since ? `waiting ${formatElapsed(serverTime, item.since)}` : "waiting age unknown";
  const worker = item.kind === "worker_offline";
  // Workers are installation-wide; a project association is not ownership.
  const where = worker ? "Installation-wide" : item.project?.label ?? "Installation";
  const name = worker ? `${item.title}, worker ${shortRef({ id: item.subject.id })}` : item.title;
  const secondary = [
    where,
    ATTENTION_SOURCE_LABEL[item.kind] ?? null,
    worker ? `worker ${shortRef({ id: item.subject.id })}` : null,
    age,
    item.reason,
    item.action && !item.action.allowed ? item.action.explanation : null,
  ].filter(Boolean).join(" · ");
  return { secondary, name };
}

type AttentionRowProps = { item: AttentionView; serverTime: string; search: string };
function AttentionAction({ item, name, search, inspect, toggle }: {
  item: AttentionView; name: string; search: string; inspect: boolean; toggle: () => void;
}) {
  const label = ACTION_LABEL[item.kind];
  const actionContent = <>{label}<Icon icon={ArrowRight} size={16} className={styles.actionArrow} /></>;
  const to = attentionDestination(item, search);
  if (to) return <Link className={styles.action} to={to} aria-label={`${label}: ${name}`}>{actionContent}</Link>;
  if (item.kind === "worker_offline" || item.kind === "uncertain_operation") {
    return <button className={styles.action} type="button" aria-expanded={inspect} aria-label={`${label}: ${name}`} onClick={toggle}>{actionContent}</button>;
  }
  return <span className={styles.meta}>{item.kind === "unsupported" ? "Unsupported item type" : "Inspection unavailable"}</span>;
}

/** Clears an informational or stale item from Needs you. It never answers, approves or resolves anything. */
function DismissButton({ item, name }: { item: AttentionView; name: string }) {
  const { enabled, mutation } = useDismissAttention();
  const failed = useDismissFailed(item.id);
  if (!enabled || !dismissible(item)) return null;
  return <>
    <button className={styles.dismiss} type="button" aria-label={`Dismiss: ${name}`} title="Dismiss from Needs you" disabled={mutation.isPending}
      onClick={() => mutation.mutate({ item })}>
      <Icon icon={X} size={16} />Dismiss
    </button>
    {failed && <span className={styles.meta} role="status">Couldn't dismiss. Try again.</span>}
  </>;
}

export function AttentionRow({ item, serverTime, search }: AttentionRowProps) {
  const [inspect, setInspect] = useState(false);
  const { secondary, name } = attentionDescription(item, serverTime);
  return (
    <li className={styles.attentionRow} data-attention-row="" data-kind={item.kind}>
      <Icon icon={ATTENTION_ICON[item.kind]} size={28} className={styles.kindIcon} />
      <div className={styles.attentionMain}>
        <span className={styles.rowTitle}>{item.title}</span>
        <span className={styles.rowSecondary} title={secondary}>{secondary}</span>
      </div>
      <span className={styles.impact}>{item.impact}</span>
      <div className={styles.rowActions}>
        <AttentionAction item={item} name={name} search={search} inspect={inspect} toggle={() => setInspect(!inspect)} />
        <DismissButton item={item} name={name} />
      </div>
      {inspect && <dl className={styles.referenceDetails}><dt>Subject</dt><dd>{item.subject.type} · {item.subject.id}</dd><dt>Revision</dt><dd>{item.subject.revision ?? "Unknown"}</dd><dt>Observation</dt><dd>{item.reason}</dd></dl>}
    </li>
  );
}
