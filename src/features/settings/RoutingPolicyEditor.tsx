import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../../api/client";
import { readRoutingDocument } from "../../api/routingDocument";
import { authorPlaybookSourceAgain, rollBackPlaybookSource, SOURCE_GAP_SENTENCES, type SourceView } from "../../api/playbookSources";
import { queryKey } from "../../api/queryKeys";
import { readRoutingPolicy, setRouting, type RoutingPolicyState } from "../../api/routing";
import { useSession } from "../../app/session";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { ROUTING_DOCUMENT, useRoutingDocumentDraft } from "./RoutingDocumentDraft";
import { PlaybookQuestion, PlaybookSourceStatus } from "./PlaybookSourceStatus";
import { TASK_ROUTE_PREFERENCES } from "../work/taskRouting";
import styles from "./RoutingPolicyEditor.module.css";

function useRoutingPolicy(pollMs: number) {
  const { queryContext } = useSession();
  const client = useQueryClient();
  const query = useQuery({ queryKey: queryKey(queryContext, ROUTING_DOCUMENT, {}), queryFn: ({ signal }) => readRoutingDocument(signal), retry: false });
  // Keyed by the document revision, so a save reads the run it started (a newer save replaces a run in flight).
  const key = queryKey(queryContext, "routing-policy", { revision: query.data?.revision ?? "" });
  const routing = useQuery({ queryKey: key, queryFn: ({ signal }) => readRoutingPolicy(signal), enabled: query.data !== undefined, retry: false, placeholderData: previous => previous,
    // A read that failed stops the polling; the error line below says so and a save reads again.
    refetchInterval: current => current.state.status !== "error" && current.state.data?.source?.latest?.status === "running" ? pollMs : false });
  const toggle = useMutation({ mutationFn: setRouting, onSuccess: enabled => client.setQueryData<RoutingPolicyState>(key, state => state && { ...state, enabled }) });
  // The view the server sends back is used at once, and the source is read again, so the screen cannot stay stale (and a new run starts the polling).
  const show = (view: SourceView) => client.setQueryData<RoutingPolicyState>(key, state => state && { ...state, source: view, gap: null });
  const reread = () => client.invalidateQueries({ queryKey: key });
  const rollback = useMutation({ mutationFn: rollBackPlaybookSource, onSuccess: show, onSettled: reread });
  const again = useMutation({ mutationFn: authorPlaybookSourceAgain, onSuccess: show, onSettled: reread });
  return { query, routing, toggle, rollback, again };
}

function RoutingMarkdown({ draft, saved }: { draft: ReturnType<typeof useRoutingDocumentDraft>; saved: string }) {
  const text = draft.policy?.value ?? saved;
  const bytes = new TextEncoder().encode(text).length;
  return <div className={styles.document}>
          <label className={styles.label} htmlFor="routing-policy-markdown">Markdown</label>
          <textarea id="routing-policy-markdown" className={styles.editor} value={text} disabled={draft.locked} spellCheck={false} onChange={event => draft.setPolicy(saved, event.target.value)} />
          <p className={styles.meta}>{bytes.toLocaleString()}{draft.limit === null ? "" : ` / ${draft.limit.toLocaleString()}`} bytes</p>
          {draft.limit !== null && bytes > draft.limit && <p className={styles.warning} role="alert">The routing document must be at most {draft.limit.toLocaleString()} bytes in UTF-8, the limit for one document (Limits, on the Roles tab).</p>}
        </div>;
}

function authorQuestion(source: SourceView | null | undefined) {
  const latest = source?.latest;
  return latest?.status === "question" ? latest.question : null;
}

function CompiledPolicy({ state, showQuestion, operations }: { state: RoutingPolicyState; showQuestion: boolean; operations: ReturnType<typeof useRoutingPolicy> }) {
  const { toggle, rollback, again } = operations;
  const source = state.source;
  return <div className={styles.compiled}>
        {source
          ? <PlaybookSourceStatus source={source} showQuestion={showQuestion} onRollback={() => rollback.mutateAsync(source.id)} onAuthorAgain={() => again.mutateAsync(source.id)} />
          : <p className={styles.meta} role="status">{SOURCE_GAP_SENTENCES[state.gap ?? "missing"]}</p>}
        <label className={styles.switch}>
          <input type="checkbox" role="switch" checked={state.enabled} disabled={(!source?.active && !state.enabled) || toggle.isPending} onChange={event => toggle.mutate(event.target.checked)} />
          Route tasks with this playbook
        </label>
        {toggle.isError && <p className={styles.warning} role="alert">{toggle.error instanceof ApiError && toggle.error.serverMessage ? toggle.error.serverMessage : "Routing could not be changed."}</p>}
      </div>;
}

/** The owner's routing document, what the authoring agent made of it, and the routing switch. */
export function RoutingPolicyEditor({ pollMs = 2000 }: { /** How often to re-read a run in progress; only tests change it. */ pollMs?: number }) {
  const { bootstrap } = useSession();
  const operations = useRoutingPolicy(pollMs);
  const { query, routing } = operations;
  const draft = useRoutingDocumentDraft();
  const state = routing.data;
  const asking = authorQuestion(state?.source);
  return <section className={styles.section} aria-labelledby="routing-policy-heading">
    <h3 id="routing-policy-heading">Routing policy</h3>
    <p className={styles.meta}>An agent turns each saved version into a playbook that routes tasks, and it takes effect when it is written. Saving again replaces a run still in progress.</p>
    {bootstrap.capability(TASK_ROUTE_PREFERENCES).enabled && <p className={styles.meta}>
      A queued task’s route can express a provider or harness preference. AQ may use another eligible candidate.
    </p>}
    {!query.data ? <QueryStatus status={query.isError ? "error" : "pending"} error={query.error} label="routing policy" onRetry={() => void query.refetch()} /> : <>
      <div className={asking ? styles.beside : undefined}>
        <RoutingMarkdown draft={draft} saved={query.data.markdown} />
        {asking && <PlaybookQuestion question={asking} />}
      </div>
      {routing.isError && <p className={styles.meta} role="status">{state ? "What the agent made of the document could not be refreshed. Showing the last view." : "What the agent made of the document could not be loaded."}</p>}
      {state && <CompiledPolicy state={state} showQuestion={!asking} operations={operations} />}
    </>}
    {draft.feedback}
  </section>;
}
