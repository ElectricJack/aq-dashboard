import { Link } from "react-router";
import { QueryStatus } from "../../../components/QueryStatus/QueryStatus";
import { RetainedNotice } from "../../../components/QueryStatus/RetainedNotice";
import { useSession } from "../../../app/session";
import { scopeSearch } from "../../../app/scope";
import { processOutcome } from "../../../api/adapters/resultsFeedback";
import { unrecognizedLabel } from "../labels";
import { useTaskResults } from "../taskWork";
import { Ago, IdValue, NotOffered, humanize } from "./common";
import styles from "./Inspector.module.css";

const REFS = 3;
const OUTCOME: Record<string, string> = { success: "Succeeded", failed: "Failed", cancelled: "Cancelled", expired: "Expired", unknown: "Unknown" };
/** The worker's own report of how its process ended (aq-server #99); a value this bundle doesn't know reads "Unknown (value)". */
function ProcessOutcome({ revision }: { revision: { process_outcome?: string | null } }) {
  const outcome = processOutcome(revision);
  if (!outcome) return null;
  return <> · <span data-process-outcome={outcome.known ? outcome.value : "unrecognized"} title="The worker's report of how its process ended. It is not acceptance or task completion.">
    Process: {outcome.known ? OUTCOME[outcome.value] ?? outcome.value : unrecognizedLabel(outcome.value)}</span></>;
}
/** The task's results from the Results feed (item 7); each opens on the Results page. */
export function TaskResults({ project, task }: { project: string; task: string }) {
  const { bootstrap } = useSession();
  const capability = bootstrap.capability("results.read");
  const query = useTaskResults(project, task, capability.enabled);
  if (!capability.enabled) return <NotOffered what="Results" reason={capability.reason} />;
  const scope = scopeSearch({ kind: "project", project_id: project });
  const all = <Link to={{ pathname: "/results", search: `${scope}&${new URLSearchParams({ task })}` }}>All results for this task</Link>;
  if (!query.data) return <QueryStatus status={query.isError ? "error" : "pending"} error={query.error} label="this task's results" subject="collection" retryLabel="task results" onRetry={() => void query.refetch()} />;
  if (!query.data.items.length) return <p className={styles.meta}>No results recorded for this task.</p>;
  return <>
    <RetainedNotice query={query} />
    <ol className={styles.results} aria-label="Results">{query.data.items.map(d => {
      const a = d.assessment, r = d.revision, at = new Date(r.submitted_at_ms).toISOString();
      const evidence = a.evidence.requirements.filter(q => q.required), attached = evidence.filter(q => q.state !== "missing").length;
      return <li key={d.result.id} data-result={d.result.id}>
        <Link className={styles.resultSummary} title={r.summary} to={{ pathname: `/results/${encodeURIComponent(d.result.id)}/revisions/${encodeURIComponent(r.revision)}`, search: scope }}>{r.summary}</Link>
        <p className={styles.meta}>
          Submitted <Ago at={at} /><ProcessOutcome revision={r} /> · Acceptance: {humanize(a.acceptance)}{a.unresolved_review && " · Needs review"}
          {" · "}{evidence.length ? `${attached} of ${evidence.length} required captures` : "No required captures"}
        </p>
        {(r.check_refs.length > 0 || r.evidence_refs.length > 0) && <p className={styles.meta} data-result-refs="">
          {r.check_refs.length > 0 && <><span>{r.check_refs.length === 1 ? "Check" : "Checks"}</span> {r.check_refs.slice(0, REFS).map(c => <IdValue key={c} id={c} label="check ID" />)}{r.check_refs.length > REFS && ` +${r.check_refs.length - REFS}`}</>}
          {r.evidence_refs.length > 0 && <> <span>Evidence</span> {r.evidence_refs.slice(0, REFS).map(c => <IdValue key={c} id={c} label="evidence ID" />)}{r.evidence_refs.length > REFS && ` +${r.evidence_refs.length - REFS}`}</>}
        </p>}
        <p className={styles.meta}><span>Result</span> <IdValue id={d.result.id} label="result ID" /> <span>Attempt</span> <IdValue id={r.attempt_id} label="result attempt ID" /></p>
      </li>;
    })}</ol>
    <p className={styles.meta}>{all}</p>
  </>;
}
