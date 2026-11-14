import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../../api/client";
import { readIntelligenceStructure } from "../../api/intelligenceSettings";
import { MAX_ROUTING_POLICY_BYTES } from "../../api/intelligenceStructure";
import { rollBackPlaybookSource } from "../../api/playbookSources";
import { queryKey } from "../../api/queryKeys";
import { readRoutingPolicy, setRouting, type RoutingPolicyState } from "../../api/routing";
import { useSession } from "../../app/session";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { useStructureDraft } from "./IntelligenceStructureControls";
import { PlaybookQuestion, PlaybookSourceStatus } from "./PlaybookSourceStatus";
import styles from "./RoutingPolicyEditor.module.css";

/** The owner's routing document, what the authoring agent made of it, and the routing switch. */
export function RoutingPolicyEditor({ pollMs = 2000 }: { /** How often to re-read a run in progress; only tests change it. */ pollMs?: number }) {
  const { queryContext } = useSession();
  const client = useQueryClient();
  const query = useQuery({ queryKey: queryKey(queryContext, "intelligence-structure", {}), queryFn: ({ signal }) => readIntelligenceStructure(signal), retry: false });
  const draft = useStructureDraft();
  const text = draft.policy?.value ?? query.data?.routing_markdown ?? "";
  const bytes = new TextEncoder().encode(text).length;
  // Keyed by the structure revision, so a save reads the run it started (a newer save replaces a run in flight).
  const key = queryKey(queryContext, "routing-policy", { revision: query.data?.revision ?? "" });
  const routing = useQuery({ queryKey: key, queryFn: ({ signal }) => readRoutingPolicy(signal), enabled: query.data !== undefined, retry: false, placeholderData: previous => previous,
    refetchInterval: current => current.state.data?.source.latest?.status === "running" ? pollMs : false });
  const toggle = useMutation({ mutationFn: setRouting, onSuccess: enabled => client.setQueryData<RoutingPolicyState>(key, state => state && { ...state, enabled }) });
  const rollback = useMutation({ mutationFn: (id: string) => rollBackPlaybookSource(id), onSuccess: () => client.invalidateQueries({ queryKey: key }) });
  const state = routing.data;
  const latest = state?.source.latest;
  const asking = latest?.status === "question" && latest.question ? latest.question : null;
  return <section className={styles.section} aria-labelledby="routing-policy-heading">
    <h3 id="routing-policy-heading">Routing policy</h3>
    <p className={styles.meta}>An agent turns each saved version into a playbook that routes tasks, and it takes effect when it is written. Saving again replaces a run still in progress.</p>
    {!query.data ? <QueryStatus status={query.isError ? "error" : "pending"} error={query.error} label="routing policy" onRetry={() => void query.refetch()} /> : <>
      <div className={asking ? styles.beside : undefined}>
        <div className={styles.document}>
          <label className={styles.label} htmlFor="routing-policy-markdown">Markdown</label>
          <textarea id="routing-policy-markdown" className={styles.editor} value={text} disabled={draft.locked} spellCheck={false} onChange={event => draft.setPolicy(query.data!.routing_markdown, event.target.value)} />
          <p className={styles.meta}>{bytes.toLocaleString()} / {MAX_ROUTING_POLICY_BYTES.toLocaleString()} bytes</p>
          {bytes > MAX_ROUTING_POLICY_BYTES && <p className={styles.warning} role="alert">Policy must be at most 128 KiB in UTF-8.</p>}
        </div>
        {asking && <PlaybookQuestion question={asking} />}
      </div>
      {routing.isError && !state && <p className={styles.meta} role="status">What the agent made of the document could not be loaded.</p>}
      {state && <div className={styles.compiled}>
        <PlaybookSourceStatus source={state.source} showQuestion={!asking} onRollback={() => rollback.mutateAsync(state.source.id)} />
        <label className={styles.switch}>
          <input type="checkbox" role="switch" checked={state.enabled} disabled={(!state.source.active && !state.enabled) || toggle.isPending} onChange={event => toggle.mutate(event.target.checked)} />
          Route tasks with this playbook
        </label>
        {toggle.isError && <p className={styles.warning} role="alert">{toggle.error instanceof ApiError && toggle.error.serverMessage ? toggle.error.serverMessage : "Routing could not be changed."}</p>}
      </div>}
    </>}
    {draft.feedback}
  </section>;
}
