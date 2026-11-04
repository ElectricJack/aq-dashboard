import { useId, type ReactNode } from "react";
import { Link } from "react-router";
import { ArrowUpRight, FileText, Info, ListChecks, TriangleAlert } from "lucide-react";
import type { DecisionDetail } from "../../api/adapters/decisions";
import { useGraphDetail } from "../../api/humanGraphReads";
import { useSession } from "../../app/session";
import { useProjects } from "../../app/useProjects";
import { Icon } from "../../components/icons";
import { ActionButton } from "../../components/layout/Workspace";
import { CopyValue, ShortId, shortDigest, shortId } from "./DecisionContext";
import styles from "./DecisionEvidence.module.css";

/**
 * Middle column of reference 03: the evidence/proposal workspace for one review.
 * Only facts the decision and human-graph reads supply are shown; the requested
 * judgment, submitter and revision diff are not offered by the server yet.
 */
export function DecisionEvidence({ detail: d, onRefresh, children }: { detail: DecisionDetail; onRefresh(): void; children?: ReactNode }) {
  const headingId = useId(), noteId = useId();
  const { bootstrap } = useSession();
  const projects = useProjects();
  const task = useGraphDetail(bootstrap.capability("human.graph.read").enabled ? d.projectId : "", "task", d.taskId);
  const title = task.data?.data.title;
  const projectName = projects.data?.view.find(p => p.id === d.projectId)?.label ?? task.data?.project.name;
  const scope = new URLSearchParams({ scope: `project:${d.projectId}` }).toString();
  const work = { pathname: `/work/${d.taskId}`, search: scope };
  const results = { pathname: "/results", search: `${scope}&${new URLSearchParams({ task: d.taskId })}` };
  const policy = d.evidence.find(e => e.label === "Validation policy")?.id;
  const superseded = !d.current;
  const status = d.finality ? { text: `Recorded decision: ${d.finality}`, tone: styles.chipNeutral }
    : d.state !== "pending" ? { text: d.state[0]!.toUpperCase() + d.state.slice(1), tone: styles.chipNeutral }
    : superseded ? { text: "Historical review", tone: styles.chipNeutral }
    : { text: "Awaiting your decision", tone: styles.chipAttention };
  return <section className={styles.panel} aria-labelledby={headingId} data-decision-evidence="">
    {superseded && <div role="status" className={styles.warning}>
      <Icon icon={TriangleAlert} size={20} className={styles.warningIcon} />
      <p>A newer result report exists. This review is historical and can't be answered. <Link className={styles.link} to={results}>View the newer report</Link></p>
    </div>}
    <header className={styles.header}>
      <nav aria-label="Breadcrumb"><ol className={styles.crumbs}>
        <li><Link to={{ pathname: "/work", search: scope }} title={d.projectId}>{projectName ?? <code>{shortId(d.projectId)}</code>}</Link></li>
        <li><Link to={work} title={d.taskId} aria-current="page">{title ?? <code>{shortId(d.taskId)}</code>}</Link></li>
      </ol></nav>
      <div className={styles.titleRow}>
        <h2 id={headingId} className={styles.title}>{title ?? `Review task ${d.taskId.slice(0, 8)}`}</h2>
        <ul className={styles.chips} aria-label="Review state">
          <li className={`${styles.chip} ${styles.chipNeutral}`}>Task version {d.taskVersion}</li>
          <li className={`${styles.chip} ${status.tone}`} data-decision-status="">{status.text}</li>
        </ul>
        <ActionButton className={styles.refresh} onClick={onRefresh}>Refresh evidence</ActionButton>
      </div>
    </header>
    <div role="note" aria-labelledby={noteId} className={styles.callout}>
      <Icon icon={Info} size={20} className={styles.calloutIcon} />
      <div>
        <h3 id={noteId} className={styles.calloutTitle}>Decision requested</h3>
        <p>{d.finality ? "This review has a recorded decision." : superseded ? "This request applies to an earlier result report." : "Approve this result report or request changes."}</p>
        {policy && <p className={styles.muted}>Validation policy · <code>{policy}</code></p>}
      </div>
    </div>
    {d.conclusion && <section className={styles.section} aria-labelledby={`${headingId}-result`}>
      <h3 id={`${headingId}-result`}>Recorded result</h3><p>{d.conclusion}</p><p className={styles.muted}>Reported process outcome: {d.processOutcome}</p>
    </section>}
    <section className={styles.section} aria-labelledby={`${headingId}-criteria`}>
      <h3 id={`${headingId}-criteria`}>Acceptance criteria</h3>
      <ol className={styles.criteria} data-decision-criteria="">{d.criteria.map(c => <li key={c}>{c}</li>)}</ol>
    </section>
    <section className={styles.section} aria-labelledby={`${headingId}-evidence`}>
      <h3 id={`${headingId}-evidence`}>Related evidence</h3>
      <ul className={styles.related}>
        <li><Link className={styles.card} to={results} title={d.reportId}>
          <Icon icon={FileText} size={20} className={styles.cardIcon} /><span className={styles.cardText}>Result report · <code>{shortId(d.reportId)}</code></span><Icon icon={ArrowUpRight} size={16} />
        </Link></li>
        <li><Link className={styles.card} to={work} title={d.taskId}>
          <Icon icon={ListChecks} size={20} className={styles.cardIcon} /><span className={styles.cardText}>Task · {title ?? <code>{shortId(d.taskId)}</code>}</span><Icon icon={ArrowUpRight} size={16} />
        </Link></li>
      </ul>
      <dl className={styles.source} aria-label="Source">
        <div><dt>Repository</dt><dd><ShortId id={d.source.repository} label="repository id" /></dd></div>
        <div><dt>Base object</dt><dd><code title={d.source.base}>{shortDigest(d.source.base)}</code><CopyValue value={d.source.base} label="base object" /></dd></div>
        <div><dt>Resulting object</dt><dd><code title={d.source.result}>{shortDigest(d.source.result)}</code><CopyValue value={d.source.result} label="resulting object" /></dd></div>
      </dl>
    </section>
    {children && <div className={styles.section}>{children}</div>}
  </section>;
}
