import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { BookOpen, ExternalLink, ShieldCheck, FileText } from "lucide-react";
import { type GraphEnvelope, type GraphNode, nodeLabel } from "../../api/adapters/humanGraph";
import { ActionButton, DetailList, Panel } from "../../components/layout/Workspace";
import { scopeSearch } from "../../app/scope";
import { DocumentBody, documentOutline, type DocumentOutlineEntry } from "./DocumentBody";
import { DocumentActions } from "./KnowledgeActions";
import { knowledgeCategoryLabel as categoryLabel } from "../actions/actionClient";
import styles from "./HumanNodeWorkspace.module.css";

export function RecordFacts({ node: n }: { node: GraphNode }) {
  return <DetailList><dt>Author</dt><dd>{n.created_by}</dd><dt>Created</dt><dd>{n.created_at}</dd><dt>Updated</dt><dd>{n.updated_at}</dd><dt>Record version</dt><dd>{n.version}</dd><dt>Content revision</dt><dd>{n.content_revision}</dd><dt>Verification</dt><dd>{nodeLabel(n.verification)}</dd><dt>Valid from</dt><dd>{n.valid_from ?? "Not specified"}</dd><dt>Valid until</dt><dd>{n.valid_until ?? "Not specified"}</dd>{n.retirement_reason && <><dt>Retirement reason</dt><dd>{n.retirement_reason}</dd></>}</DetailList>;
}
const shortDate = (iso: string, year?: number) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const sameYear = year !== undefined && d.getUTCFullYear() === year;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }), timeZone: "UTC" });
};
const When = ({ iso, year }: { iso: string; year?: number }) => <time dateTime={iso} title={iso}>{shortDate(iso, year)}</time>;
const str = (v: unknown) => typeof v === "string" && v.length > 0 ? v : undefined;
const short = (v: unknown) => str(v)?.slice(0, 7);
const httpUrl = (v: unknown) => { const raw = str(v); if (!raw) return undefined; try { const u = new URL(raw); return u.protocol === "https:" || u.protocol === "http:" ? u : undefined; } catch { return undefined; } };

type SourceView = { title: string; meta?: ReactNode; label: string; href?: string };
/** Readable summary of a typed provenance descriptor (human-graph Source oneOf). Never fetches or asserts retention beyond the descriptor. */
function describeSource(source: unknown, index: number, year: number): SourceView {
  const d = typeof source === "object" && source !== null ? source as Record<string, unknown> : {};
  const fallback = `Recorded source ${index + 1}`;
  switch (d.kind) {
    case "task": return { title: `Task ${str(d.task_id) ?? "unknown"}`, meta: str(d.attempt_id) ? `attempt ${short(d.attempt_id)}` : undefined, label: "Task record" };
    case "review": return { title: `Review ${str(d.review_id) ?? "unknown"}`, meta: typeof d.revision === "number" ? `r${d.revision}` : undefined, label: "Review revision" };
    case "git": return { title: str(d.path) ?? str(d.repository) ?? fallback, meta: short(d.commit), label: "Git commit" };
    case "artifact": return { title: `Artifact ${short(d.artifact_id) ?? "unknown"}`, meta: short(d.sha256) ? `sha256 ${short(d.sha256)}` : undefined, label: "Artifact" };
    case "url": {
      const u = httpUrl(d.url);
      return { title: u ? `${u.host}${u.pathname === "/" ? "" : u.pathname}` : str(d.url) ?? fallback, href: u?.href, meta: str(d.observed_at) ? <When iso={d.observed_at as string} year={year} /> : undefined, label: d.retained === true ? "Retained snapshot" : "External page" };
    }
    case "legacy": return { title: [str(d.store), str(d.key)].filter(Boolean).join("/") || fallback, meta: str(d.snapshot_id) ? `snapshot ${short(d.snapshot_id)}` : undefined, label: "Legacy snapshot" };
    default: return { title: str(d.source_id) ?? fallback, label: "Recorded source" };
  }
}
function SourceList({ node, year }: { node: GraphNode; year: number }) {
  if (!node.provenance.length) return <p className={styles.meta}>No sources recorded for this revision.</p>;
  return <ul className={styles.sourceCards} aria-label="Recorded sources">{node.provenance.map((source, index) => {
    const v = describeSource(source, index, year);
    const title = v.href ? <a href={v.href} target="_blank" rel="noreferrer noopener">{v.title}<ExternalLink size={13} aria-label="opens in a new tab" /></a> : <span className={styles.sourceTitle}>{v.title}</span>;
    return <li key={index}><FileText size={20} aria-hidden /><div className={styles.sourceMain}>{title}{v.meta && <span className={styles.meta}> · {v.meta}</span>}</div><span className={styles.sourceKind}>{v.label}</span><details className={styles.technical}><summary>Technical reference</summary><code>{JSON.stringify(source)}</code></details></li>;
  })}</ul>;
}
type TabKey = "content" | "sources" | "history" | "relationships";
function DocumentTabs({ tab, setTab, sources }: { tab: TabKey; setTab: (t: TabKey) => void; sources: number }) {
  const scroller = useRef<HTMLDivElement>(null), [more, setMore] = useState(false);
  useEffect(() => {
    const el = scroller.current; if (!el) return;
    const update = () => setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    update(); el.addEventListener("scroll", update, { passive: true });
    const ro = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update); ro?.observe(el);
    return () => { el.removeEventListener("scroll", update); ro?.disconnect(); };
  }, []);
  const tabs: { key: TabKey; label: string; count?: number; disabled?: string }[] = [
    { key: "content", label: "Content" }, { key: "sources", label: "Sources", count: sources }, { key: "history", label: "History" },
    { key: "relationships", label: "Relationships", disabled: "Relationship browsing is not offered by this read contract" },
  ];
  const enabled = tabs.filter(t => !t.disabled).map(t => t.key);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = enabled.indexOf(tab), last = enabled.length - 1;
    const next = e.key === "ArrowRight" ? enabled[i === last ? 0 : i + 1] : e.key === "ArrowLeft" ? enabled[i === 0 ? last : i - 1] : e.key === "Home" ? enabled[0] : e.key === "End" ? enabled[last] : undefined;
    if (!next) return;
    e.preventDefault(); setTab(next); scroller.current?.querySelector<HTMLElement>(`#doc-tab-${next}`)?.focus();
  };
  return <div className={styles.documentTabsWrap} data-more={more || undefined}>
    <div ref={scroller} className={styles.documentTabs} role="tablist" aria-label="Document sections" onKeyDown={onKeyDown}>
      {tabs.map(t => <button key={t.key} id={`doc-tab-${t.key}`} type="button" role="tab" aria-selected={tab === t.key} aria-controls={t.disabled ? undefined : `doc-panel-${t.key}`} aria-disabled={t.disabled ? true : undefined} title={t.disabled} tabIndex={tab === t.key ? 0 : -1} onClick={() => { if (!t.disabled) setTab(t.key); }}>{t.label}{t.count !== undefined && <span className={styles.countPill}>{t.count}</span>}</button>)}
    </div>
  </div>;
}
/** Phone/tablet section navigation; hidden at desktop width where the document fits its pane. */
function SectionOutline({ outline }: { outline: DocumentOutlineEntry[] }) {
  const labelId = useId();
  const jump = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    const heading = document.getElementById(id);
    if (!heading) return;
    event.preventDefault();
    heading.scrollIntoView({ block: "start" });
    heading.focus({ preventScroll: true });
  };
  return <nav className={styles.sectionOutline} aria-labelledby={labelId}>
    <span id={labelId}>On this page</span>
    <ul>{outline.map(entry => <li key={entry.id}><a href={`#${entry.id}`} data-level={entry.level} onClick={event => jump(event, entry.id)}>{entry.text}</a></li>)}</ul>
  </nav>;
}
export function KnowledgeDocument({ record, pinned, notice }: { record: GraphEnvelope<GraphNode>; pinned?: string; notice?: ReactNode }) {
  const n = record.data, [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<TabKey>("content"), [revision, setRevision] = useState(pinned ?? "");
  const listParams = new URLSearchParams(params); listParams.delete("revision");
  const year = new Date(record.observed_at).getUTCFullYear();
  const recorded = [n.last_verified_by && `Recorded by ${n.last_verified_by}`, n.last_verified_at && <When key="at" iso={n.last_verified_at} year={year} />, (n.last_verified_by || n.last_verified_at) && `applies to revision ${n.content_revision}`].filter(Boolean);
  const outline = useMemo(() => documentOutline(n.body, "doc"), [n.body]);
  // The back link precedes the document so phones read it as a page with a visible exit.
  return <>
  <Link className={`${styles.back} ${styles.documentBack}`} to={{ pathname: "/knowledge", search: `?${listParams}` }}>All records</Link>
  <Panel title={n.title} actions={<DocumentActions record={record} pinned={pinned} />} className={`${styles.detail} ${styles.knowledgeDocument}`}>
    {notice}
    <div className={styles.documentIdentity}>
      <span><BookOpen size={16} aria-hidden />{categoryLabel(n.content_type)}</span>
      <span data-tone={n.retired ? "retired" : "active"}>{n.deleted ? "Deleted" : n.retired ? "Retired" : "Active"}</span>
      <span data-tone={n.verification ?? "unknown"}><ShieldCheck size={16} aria-hidden />{nodeLabel(n.verification)}</span>
      <span className={styles.meta}>{pinned ? "Pinned" : "Current"} revision {n.content_revision}</span>
    </div>
    <p className={styles.meta}>Project: {record.project.name} · Updated <When iso={n.updated_at} year={year} /></p>
    <DocumentTabs tab={tab} setTab={setTab} sources={n.provenance.length} />
    <div id={`doc-panel-${tab}`} role="tabpanel" aria-labelledby={`doc-tab-${tab}`} className={styles.documentPanel}>
    {tab === "content" && <>
      {outline.length > 1 && <SectionOutline outline={outline} />}
      <DocumentBody body={n.body} idPrefix="doc" />
      <section className={styles.documentVerification} aria-label="Verification assertion"><ShieldCheck size={22} aria-hidden /><div>
        <h3>Verification</h3>
        <p>{nodeLabel(n.verification)}</p>
        {recorded.length > 0 && <p className={styles.verificationFacts}>{recorded.map((part, i) => <span key={i}>{i > 0 && "· "}{part}</span>)}</p>}
        {n.review_at && <p className={styles.verificationFacts}><span>Next review: <When iso={n.review_at} year={year} /></span></p>}
        {n.valid_until && <p className={styles.verificationFacts}><span>Valid until <When iso={n.valid_until} year={year} /></span></p>}
      </div></section>
      <div className={styles.documentLinks}>
        <section className={styles.sourcesPanel} aria-labelledby="doc-sources-heading"><h3 id="doc-sources-heading">Sources ({n.provenance.length})</h3><SourceList node={n} year={year} /></section>
        <section className={styles.sourcesPanel} aria-labelledby="doc-linked-heading"><h3 id="doc-linked-heading">Linked work</h3><p className={styles.meta}>Linked work is not offered by this read contract.</p></section>
      </div>
    </>}
    {tab === "sources" && <SourceList node={n} year={year} />}
    {tab === "history" && <section className={styles.revisionHistory}><h3>Revision history</h3><p>Open an exact content revision. Revision listing is not available yet.</p><form className={styles.revisions} onSubmit={e => { e.preventDefault(); if (/^[1-9][0-9]{0,19}$/.test(revision)) setParams(previous => { const next = new URLSearchParams(previous); next.set("revision", revision); return next; }); }}><label>Exact content revision<input value={revision} onChange={e => setRevision(e.target.value)} inputMode="numeric" pattern="[1-9][0-9]*" maxLength={20} /></label><ActionButton type="submit" disabled={!/^[1-9][0-9]{0,19}$/.test(revision)}>View revision</ActionButton>{pinned && <ActionButton onClick={() => setParams(previous => { const next = new URLSearchParams(previous); next.delete("revision"); return next; })}>Return to current</ActionButton>}</form></section>}
    </div>
    <details className={styles.recordDisclosure}><summary>Record details</summary><RecordFacts node={n} />{n.successor_id && <Link to={{ pathname: `/knowledge/${encodeURIComponent(n.successor_id)}`, search: scopeSearch({ kind: "project", project_id: record.project.id }) }}>Open successor record</Link>}</details>
    <p className={styles.footer}>{pinned ? `Viewing pinned revision ${n.content_revision} · Return to current from History` : `Current revision ${n.content_revision} · Older revisions remain available`}</p>
  </Panel>
  </>;
}
