import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { adaptWaitDetail, adaptWaitList, type WaitDetail } from "../../../api/adapters/waits";
import { ApiError, apiGet } from "../../../api/client";
import { queryKey } from "../../../api/queryKeys";
import { useSession } from "../../../app/session";
import { DetailList } from "../../../components/layout/Workspace";
import { QueryStatus } from "../../../components/QueryStatus/QueryStatus";
import type { SessionDetailView } from "../../../api/adapters/inspection";
import styles from "./Operations.module.css";

const PHASE: Record<string, string> = { installing: "Installing", pending: "Pending", recovery_held: "Held for recovery", terminal: "Resolved" };
const missing = (e: unknown) => e instanceof ApiError && [404, 405, 501].includes(e.status ?? 0);

/** U13: registered waits for this session's attempt, read only while this view is open. */
export function WaitsView({ session: s }: { session: SessionDetailView }) {
  const { queryContext } = useSession();
  const [selected, setSelected] = useState<string | null>(null);
  const query = useQuery({ queryKey: queryKey(queryContext, "session-waits", { attempt: s.attemptId }), retry: false, refetchOnWindowFocus: false,
    enabled: !!s.attemptId, queryFn: async ({ signal }) => adaptWaitList(await apiGet<unknown>("/api/waits", signal), s.attemptId) });
  return <section aria-label="Waits" className={styles.view}>
    <h3>Waits</h3>
    {!s.attemptId ? <p className={styles.muted}>This session has no attempt, so it has no registered waits.</p>
      : missing(query.error) ? <p>Waits unavailable on this AQ server</p>
      : query.isError || !query.data ? <QueryStatus status={query.isError ? "error" : "pending"} error={query.error} label="waits" onRetry={() => void query.refetch()} />
      : query.data.length === 0 ? <p>No registered waits for this attempt.</p> : <>
        <ul aria-label="Registered waits" className={styles.list}>{query.data.map(w => <li key={w.id}>
          <button type="button" aria-pressed={selected === w.id} aria-label={`Inspect wait ${w.id}`} onClick={() => setSelected(w.id)}>
            <strong>Wait {w.id.slice(0, 8)}</strong>
            <span className={styles.muted}>{PHASE[w.phase] ?? "Unsupported phase"} · revision {w.revision}{w.deadline ? ` · deadline ${w.deadline}` : " · no deadline"}</span>
          </button>
        </li>)}</ul>
        {selected && <WaitInspection key={selected} id={selected} />}
      </>}
  </section>;
}

function WaitInspection({ id }: { id: string }) {
  const { queryContext } = useSession();
  const query = useQuery({ queryKey: queryKey(queryContext, "wait-detail", { id }), retry: false, refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => adaptWaitDetail(await apiGet<unknown>(`/api/waits/${encodeURIComponent(id)}`, signal), id) });
  if (query.isError || !query.data) return <QueryStatus status={query.isError ? "error" : "pending"} error={query.error} label="this wait" onRetry={() => void query.refetch()} />;
  return <WaitFacts wait={query.data} />;
}

function WaitFacts({ wait: w }: { wait: WaitDetail }) {
  return <section aria-label={`Wait ${w.id}`} className={styles.detail}>
    <h4>Wait {w.id.slice(0, 8)}</h4>
    <strong>{w.lifecycle}</strong>
    <DetailList>
      <dt>Predicate</dt><dd>{w.predicate}</dd>
      <dt>Phase</dt><dd>{PHASE[w.phase] ?? "Unsupported phase"} · revision {w.revision} · wait generation {w.generation}</dd>
      <dt>Deadline</dt><dd>{w.deadline ? `Deadline ${w.deadline}` : "No deadline"}{w.nextDue ? ` · next check ${w.nextDue}` : ""}</dd>
      <dt>Continuation</dt><dd>{w.continuation} · Continuation generation {w.continuationGeneration}</dd>
      <dt>Admission blocker</dt><dd>{w.blocker ?? "None reported"}</dd>
      <dt>Compute</dt><dd>{w.compute}</dd>
      <dt>Disk</dt><dd>{w.disk}</dd>
      <dt>Outcome</dt><dd>{w.outcome ? <>{w.outcome.label}{w.outcome.override && " · resumed before its conditions resolved"}{w.outcome.recordedAt && ` · recorded ${w.outcome.recordedAt}`}</> : "Unresolved"}</dd>
    </DetailList>
    <ul aria-label="Wait conditions" className={styles.facts}>{w.members.map(m => <li key={m.id}>
      <strong>{m.condition}</strong>
      <span>{m.state}{m.lastChecked && ` · checked ${m.lastChecked}`}{m.lastVerified && ` · verified ${m.lastVerified}`}</span>
      <span className={styles.muted}>{m.evidence ?? "No verified source result"}{m.unavailableReason && ` · ${m.unavailableReason}`}</span>
    </li>)}</ul>
    <p className={styles.muted}>Cancelling a wait does not cancel the task.</p>
  </section>;
}
