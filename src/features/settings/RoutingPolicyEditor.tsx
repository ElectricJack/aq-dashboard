import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { readIntelligenceStructure } from "../../api/intelligenceSettings";
import { MAX_ROUTING_POLICY_BYTES } from "../../api/intelligenceStructure";
import { queryKey } from "../../api/queryKeys";
import { readRoutingPolicy, setRouting, type RoutingPolicyState } from "../../api/routing";
import { useSession } from "../../app/session";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { InternalRun } from "../internal/InternalRun";
import { useStructureDraft } from "./IntelligenceStructureControls";
import { Timestamp } from "./Timestamp";
import styles from "./RoutingPolicyEditor.module.css";

/** How the saved policy compiled: in progress, what routes now, or why the latest version did not take effect; and the routing switch. */
function CompiledPolicy({ revision, pollMs }: { revision: string; pollMs: number }) {
  const { queryContext } = useSession();
  const client = useQueryClient();
  // Keyed by the structure revision, so a save reads the compile it started.
  const key = queryKey(queryContext, "routing-policy", { revision });
  const query = useQuery({ queryKey: key, queryFn: ({ signal }) => readRoutingPolicy(signal), retry: false, placeholderData: previous => previous,
    refetchInterval: current => current.state.data?.latest?.status === "compiling" ? pollMs : false });
  const toggle = useMutation({ mutationFn: setRouting, onSuccess: state => client.setQueryData<RoutingPolicyState>(key, state) });
  if (query.isError) return <p className={styles.meta} role="status">How the policy compiled could not be loaded.</p>;
  if (!query.data) return null;
  const { enabled, active, latest } = query.data;
  const failed = latest?.status === "failed" ? latest : null;
  return <div className={styles.compiled}>
    {latest?.status === "compiling" && <p className={styles.meta} role="status">Compiling…</p>}
    {failed && <div className={styles.failure} role="alert">
      <p>This version did not compile. {active ? "The previous policy is still routing." : "No policy is routing yet."}</p>
      {failed.problems.length > 0 && <ul aria-label="Compile problems">{failed.problems.map(problem => <li key={`${problem.path}:${problem.message}`}>{problem.message} <code className={styles.path}>{problem.path}</code></li>)}</ul>}
      {failed.unresolved.length > 0 && <>
        <p>These sentences could not be resolved:</p>
        <ul aria-label="Unresolved sentences">{failed.unresolved.map(sentence => <li key={sentence}><q>{sentence}</q></li>)}</ul>
      </>}
      {failed.problems.length === 0 && failed.unresolved.length === 0 && failed.error && <p className={styles.detail}>{failed.error}</p>}
    </div>}
    {failed && <InternalRun affectedKind="routing_policy" affectedId={String(failed.structure_revision)} />}
    {active && <section className={styles.summary} aria-labelledby="routing-policy-summary">
      <h4 id="routing-policy-summary">How this policy routes</h4>
      {active.took_effect_at_ms !== null && <p className={styles.meta}>In effect since <Timestamp iso={new Date(active.took_effect_at_ms).toISOString()} />.</p>}
      <ul>{active.summary.map(sentence => <li key={sentence}>{sentence}</li>)}</ul>
      {active.problems.length > 0 && <div className={styles.warning} role="alert">
        <p>Settings changed since this policy compiled, and it no longer fits them:</p>
        <ul aria-label="Active policy problems">{active.problems.map(problem => <li key={`${problem.path}:${problem.message}`}>{problem.message} <code className={styles.path}>{problem.path}</code></li>)}</ul>
      </div>}
    </section>}
    <label className={styles.switch}>
      <input type="checkbox" role="switch" checked={enabled} disabled={(!active && !enabled) || toggle.isPending} onChange={event => toggle.mutate(event.target.checked)} />
      Route tasks with this policy
    </label>
    {toggle.isError && <p className={styles.warning} role="alert">Routing could not be changed.</p>}
  </div>;
}

export function RoutingPolicyEditor({ pollMs = 2000 }: { /** How often to re-read a compile in progress; only tests change it. */ pollMs?: number }) {
  const { queryContext } = useSession();
  const query = useQuery({ queryKey: queryKey(queryContext, "intelligence-structure", {}), queryFn: ({ signal }) => readIntelligenceStructure(signal), retry: false });
  const draft = useStructureDraft();
  const text = draft.policy?.value ?? query.data?.routing_markdown ?? "";
  const bytes = new TextEncoder().encode(text).length;
  return <section className={styles.section} aria-labelledby="routing-policy-heading">
    <h3 id="routing-policy-heading">Routing policy</h3>
    <p className={styles.meta}>Saved changes are compiled and take effect when they compile.</p>
    {!query.data ? <QueryStatus status={query.isError ? "error" : "pending"} error={query.error} label="routing policy" onRetry={() => void query.refetch()} /> : <>
      <label className={styles.label} htmlFor="routing-policy-markdown">Markdown</label>
      <textarea id="routing-policy-markdown" className={styles.editor} value={text} disabled={draft.locked} spellCheck={false} onChange={event => draft.setPolicy(query.data!.routing_markdown, event.target.value)} />
      <p className={styles.meta}>{bytes.toLocaleString()} / {MAX_ROUTING_POLICY_BYTES.toLocaleString()} bytes</p>
      {bytes > MAX_ROUTING_POLICY_BYTES && <p className={styles.warning} role="alert">Policy must be at most 128 KiB in UTF-8.</p>}
      <CompiledPolicy revision={query.data.revision} pollMs={pollMs} />
    </>}
    {draft.feedback}
  </section>;
}
