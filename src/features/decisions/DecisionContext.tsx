import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Check, Clock, Copy, FileText } from "lucide-react";
import type { DecisionDetail } from "../../api/adapters/decisions";
import { useGraphDetail } from "../../api/humanGraphReads";
import { useSession } from "../../app/session";
import { useProjects } from "../../app/useProjects";
import { Icon } from "../../components/icons";
import { Panel } from "../../components/layout/Workspace";
import { formatAge } from "../../components/time/relative";
import { useServerNow } from "../../components/time/useServerNow";
import styles from "./DecisionContext.module.css";

/** `00000000…0003`: enough of an id to recognise it, with the full value kept for copy and title. */
export const shortId = (id: string) => (id.length > 13 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id);
const shortDigest = (digest: string) => digest.slice(0, 12);

function CopyValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!copied) return; const t = setTimeout(() => setCopied(false), 1500); return () => clearTimeout(t); }, [copied]);
  return <button type="button" className={styles.copy} aria-label={copied ? `${label} copied` : `Copy ${label}`} title={copied ? "Copied" : `Copy ${label}`}
    onClick={() => { void navigator.clipboard?.writeText(value).then(() => setCopied(true), () => undefined); }}>
    <Icon icon={copied ? Check : Copy} size={16} />
  </button>;
}

function ShortId({ id, label }: { id: string; label: string }) {
  return <span className={styles.idValue}><code title={id}>{shortId(id)}</code><CopyValue value={id} label={label} /></span>;
}

/**
 * Elapsed time since the detail read last succeeded, measured monotonically
 * from when the response arrived; the local wall clock is never shown.
 */
function useCheckedAge(updatedAt: number) {
  const receivedAt = useMemo(() => performance.now(), [updatedAt]);
  const origin = new Date(0).toISOString();
  const now = useServerNow({ serverTime: origin, receivedAt }, { tickMs: 5_000 });
  return now ? formatAge(now, origin) : null;
}

/** Right column of reference 03: key/value context, evidence cards, next steps and checked age. */
export function DecisionContext({ detail: d, updatedAt, className }: { detail: DecisionDetail; updatedAt: number; className?: string }) {
  const { bootstrap } = useSession();
  const projects = useProjects();
  const projectName = projects.data?.view.find(p => p.id === d.projectId)?.label;
  const graphReadable = bootstrap.capability("human.graph.read").enabled;
  const task = useGraphDetail(graphReadable ? d.projectId : "", "task", d.taskId);
  const taskTitle = task.data?.data.title;
  const scope = new URLSearchParams({ scope: `project:${d.projectId}` }).toString();
  const checked = useCheckedAge(updatedAt);
  return <Panel title="Decision context" className={[styles.context, className].filter(Boolean).join(" ")} data-decision-context="">
    <dl className={styles.facts}>
      <div><dt>Project</dt><dd>{projectName ? <span className={styles.name}>{projectName}</span> : <ShortId id={d.projectId} label="project id" />}</dd></div>
      <div><dt>Task</dt><dd><Link className={styles.link} to={{ pathname: `/work/${d.taskId}`, search: scope }} title={d.taskId}>{taskTitle ?? <code>{shortId(d.taskId)}</code>}</Link>{!taskTitle && <CopyValue value={d.taskId} label="task id" />}</dd></div>
      <div><dt>Report</dt><dd><Link className={styles.link} to={{ pathname: "/results", search: `${scope}&${new URLSearchParams({ task: d.taskId })}` }} title={d.reportId}><code>{shortId(d.reportId)}</code></Link><CopyValue value={d.reportId} label="report id" /></dd></div>
    </dl>
    <h3 className={styles.section}>Evidence</h3>
    <ul className={styles.evidence}>{d.evidence.map(e => <li key={e.label} className={styles.card} data-evidence="">
      <Icon icon={FileText} size={22} className={styles.cardIcon} />
      <div className={styles.cardBody}>
        <strong className={styles.cardLabel} data-evidence-label="">{e.label}</strong>
        <span className={styles.muted} data-evidence-id="">{e.id}</span>
        <span className={styles.digest}><code title={e.digest}>{shortDigest(e.digest)}</code><CopyValue value={e.digest} label={`${e.label} digest`} /></span>
      </div>
    </li>)}</ul>
    <h3 className={styles.section}>What happens next</h3>
    <p className={styles.next}>A recorded answer does not establish task completion or source publication.</p>
    {checked && <p className={styles.checked}><Icon icon={Clock} size={16} />Revision checked {checked}</p>}
  </Panel>;
}
