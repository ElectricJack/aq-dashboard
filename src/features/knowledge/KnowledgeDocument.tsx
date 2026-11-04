import { useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { BookOpen, ShieldCheck, FileText } from "lucide-react";
import { type GraphEnvelope, type GraphNode, nodeLabel } from "../../api/adapters/humanGraph";
import { ActionButton, DetailList, Panel } from "../../components/layout/Workspace";
import { scopeSearch } from "../../app/scope";
import { DocumentBody } from "./DocumentBody";
import { DocumentActions } from "./KnowledgeActions";
import styles from "./HumanNodeWorkspace.module.css";

const categoryLabel = (value: string | null | undefined) => value ? value.replace(/[_-]+/g, " ").replace(/^./, c => c.toUpperCase()) : "Uncategorized";
/** Short UTC date ("Nov 1"); the year is added when it differs from the server observation. */
export function shortDate(iso: string, observed?: string) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const sameYear = observed ? new Date(observed).getUTCFullYear() === at.getUTCFullYear() : true;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }), timeZone: "UTC" }).format(at);
}

export function RecordFacts({ node: n }: { node: GraphNode }) {
  return <DetailList><dt>Author</dt><dd>{n.created_by}</dd><dt>Created</dt><dd>{n.created_at}</dd><dt>Updated</dt><dd>{n.updated_at}</dd><dt>Record version</dt><dd>{n.version}</dd><dt>Content revision</dt><dd>{n.content_revision}</dd><dt>Verification</dt><dd>{nodeLabel(n.verification)}</dd><dt>Valid from</dt><dd>{n.valid_from ?? "Not specified"}</dd><dt>Valid until</dt><dd>{n.valid_until ?? "Not specified"}</dd>{n.retirement_reason && <><dt>Retirement reason</dt><dd>{n.retirement_reason}</dd></>}</DetailList>;
}
function Sources({ node }: { node: GraphNode }) {
  return node.provenance.length ? <ul className={styles.sourceCards} aria-label="Recorded sources">{node.provenance.map((source, index) => {
    const descriptor = typeof source === "object" && source !== null ? source as Record<string, unknown> : {};
    const title = [descriptor.title, descriptor.source_id, descriptor.kind].find(v => typeof v === "string") as string | undefined;
    return <li key={index}><FileText size={20} aria-hidden /><div><strong>{title ?? `Recorded source ${index + 1}`}</strong><details><summary>Source reference</summary><pre>{JSON.stringify(source, null, 2)}</pre></details></div></li>;
  })}</ul> : <p className={styles.meta}>No sources recorded for this revision.</p>;
}
export function KnowledgeDocument({ record, pinned, notice }: { record: GraphEnvelope<GraphNode>; pinned?: string; notice?: ReactNode }) {
  const n = record.data, [params, setParams] = useSearchParams();
  const [tab, setTab] = useState("content"), [revision, setRevision] = useState(pinned ?? "");
  const listParams = new URLSearchParams(params); listParams.delete("revision");
  return <Panel title={n.title} actions={<DocumentActions record={record} pinned={pinned} />} className={`${styles.detail} ${styles.knowledgeDocument}`}>
    {notice}
    <Link className={styles.back} to={{ pathname: "/knowledge", search: `?${listParams}` }}>All records</Link>
    <div className={styles.documentIdentity}>
      <span><BookOpen size={16} aria-hidden />{categoryLabel(n.content_type)}</span>
      <span data-tone={n.retired ? "retired" : "active"}>{n.deleted ? "Deleted" : n.retired ? "Retired" : "Active"}</span>
      <span data-tone={n.verification ?? "unknown"}><ShieldCheck size={16} aria-hidden />{nodeLabel(n.verification)}</span>
      <span className={styles.meta}>{pinned ? "Pinned" : "Current"} revision {n.content_revision}</span>
    </div>
    <p className={styles.meta}>Project: {record.project.name} · Updated <time dateTime={n.updated_at} title={n.updated_at}>{shortDate(n.updated_at, record.observed_at)}</time></p>
    <nav className={styles.documentTabs} aria-label="Document sections">
      {[ ["content", "Content"], ["sources", `Sources (${n.provenance.length})`], ["history", "History"] ].map(([key, label]) => <button key={key} type="button" aria-current={tab === key ? "page" : undefined} onClick={() => setTab(key!)}>{label}</button>)}
      <button type="button" disabled title="Relationship browsing is not offered by this read contract">Relationships</button>
    </nav>
    {tab === "content" && <>
      <DocumentBody body={n.body} />
      <section className={styles.documentVerification} aria-label="Verification assertion"><ShieldCheck size={22} aria-hidden /><div><h3>Verification</h3><p>{nodeLabel(n.verification)}{n.last_verified_by ? ` · Recorded by ${n.last_verified_by}` : ""}</p>{n.last_verified_at && <p className={styles.meta}>Recorded <time dateTime={n.last_verified_at}>{n.last_verified_at}</time></p>}{n.review_at && <p className={styles.meta}>Next review: {n.review_at}</p>}</div></section>
      <section className={styles.sourcesPanel}><h3>Sources ({n.provenance.length})</h3><Sources node={n} /></section>
    </>}
    {tab === "sources" && <Sources node={n} />}
    {tab === "history" && <section className={styles.revisionHistory}><h3>Revision history</h3><p>Open an exact content revision. Revision listing is not available yet.</p><form className={styles.revisions} onSubmit={e => { e.preventDefault(); if (/^[1-9][0-9]{0,19}$/.test(revision)) setParams(previous => { const next = new URLSearchParams(previous); next.set("revision", revision); return next; }); }}><label>Exact content revision<input value={revision} onChange={e => setRevision(e.target.value)} inputMode="numeric" pattern="[1-9][0-9]*" maxLength={20} /></label><ActionButton type="submit" disabled={!/^[1-9][0-9]{0,19}$/.test(revision)}>View revision</ActionButton>{pinned && <ActionButton onClick={() => setParams(previous => { const next = new URLSearchParams(previous); next.delete("revision"); return next; })}>Return to current</ActionButton>}</form></section>}
    <details className={styles.recordDisclosure}><summary>Record details</summary><RecordFacts node={n} />{n.successor_id && <Link to={{ pathname: `/knowledge/${encodeURIComponent(n.successor_id)}`, search: scopeSearch({ kind: "project", project_id: record.project.id }) }}>Open successor record</Link>}</details>
    <p className={styles.footer}>{pinned ? `Viewing pinned revision ${n.content_revision}` : `Current content revision ${n.content_revision}`} · Observed {record.observed_at}</p>
  </Panel>;
}
