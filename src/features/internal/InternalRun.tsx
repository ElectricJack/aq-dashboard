import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listInternalRuns, retryInternalRun, type InternalRunAttempt } from "../../api/internalWork";
import { queryKey } from "../../api/queryKeys";
import { useSession } from "../../app/session";
import { ActionButton } from "../../components/layout/Workspace";
import styles from "./InternalRun.module.css";

const WAY: Record<string, string> = { api: "API", login: "logged-in harness" };
export function duration(ms: number) { return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`; }
const reasonText = (reason: string | null) => (reason ?? "").replaceAll("_", " ");
function Attempt({ attempt }: { attempt: InternalRunAttempt }) {
  return <li>{attempt.provider} · {attempt.model} ({WAY[attempt.way]}), {duration(attempt.elapsed_ms)}: {attempt.reason ? `${reasonText(attempt.reason)}${attempt.detail ? ` - ${attempt.detail}` : ""}` : "answered"}</li>;
}

/** The newest internal run for one item: what was asked, who answered, how long it took, the answer or the error, and Retry on a failure. Renders nothing when there is no run. */
export function InternalRun({ affectedKind, affectedId }: { affectedKind: string; affectedId: string }) {
  const { queryContext } = useSession();
  const client = useQueryClient();
  const params = { affected_kind: affectedKind, affected_id: affectedId, limit: 1 };
  const key = queryKey(queryContext, "internal-run", params);
  const query = useQuery({ queryKey: key, queryFn: ({ signal }) => listInternalRuns(params, signal), retry: false });
  const retry = useMutation({ mutationFn: retryInternalRun, onSuccess: () => client.invalidateQueries({ queryKey: key }) });
  const run = query.data?.runs[0];
  if (query.isError) return <p className={styles.meta} role="status">Internal work could not be loaded.</p>;
  if (!run) return null;
  return <section className={styles.run} aria-label="Internal work">
    <div className={styles.head}>
      <h4>Internal work</h4>
      <span className={styles.meta}>{run.purpose.replaceAll("_", " ")} · {run.status}{run.retry_of ? " · retry" : ""}</span>
    </div>
    <details>
      <summary>What was asked</summary>
      <pre className={styles.pre}>{run.instructions}</pre>
      <pre className={styles.pre}>{run.input}</pre>
    </details>
    {run.status === "answered" && <>
      <p className={styles.meta}>Answered by {run.provider} · {run.model} ({WAY[run.way ?? "api"]}) in {duration(run.elapsed_ms ?? 0)}</p>
      <pre className={styles.pre} aria-label="Answer">{typeof run.answer === "string" ? run.answer : JSON.stringify(run.answer, null, 2)}</pre>
    </>}
    {run.status === "failed" && <p className={styles.failed} role="alert">Failed: {reasonText(run.reason ?? null)}{run.detail ? ` - ${run.detail}` : ""}</p>}
    {(run.status === "queued" || run.status === "running") && <p className={styles.meta}>{run.status === "queued" ? "Waiting for a model." : "A model is working on it."}</p>}
    {run.attempts.length > 0 && <ul className={styles.attempts} aria-label="Attempts">{run.attempts.map((attempt, index) => <Attempt key={index} attempt={attempt} />)}</ul>}
    {run.status === "failed" && <div className={styles.actions}>
      <ActionButton disabled={retry.isPending} onClick={() => retry.mutate(run.id)}>Retry</ActionButton>
      {retry.isError && <span className={styles.failed} role="alert">The retry could not be started.</span>}
    </div>}
  </section>;
}
