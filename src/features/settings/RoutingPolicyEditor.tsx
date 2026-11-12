import { useQuery } from "@tanstack/react-query";
import { readIntelligenceStructure } from "../../api/intelligenceSettings";
import { MAX_ROUTING_POLICY_BYTES } from "../../api/intelligenceStructure";
import { queryKey } from "../../api/queryKeys";
import { useSession } from "../../app/session";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { useStructureDraft } from "./IntelligenceStructureControls";
import styles from "./RoutingPolicyEditor.module.css";

export function RoutingPolicyEditor() {
  const { queryContext } = useSession();
  const query = useQuery({ queryKey: queryKey(queryContext, "intelligence-structure", {}), queryFn: ({ signal }) => readIntelligenceStructure(signal), retry: false });
  const draft = useStructureDraft();
  const text = draft.policy?.value ?? query.data?.routing_markdown ?? "";
  const bytes = new TextEncoder().encode(text).length;
  return <section className={styles.section} aria-labelledby="routing-policy-heading">
    <h3 id="routing-policy-heading">Routing policy</h3>
    <p className={styles.meta}>Saved policy source; playbook execution will be connected later.</p>
    {!query.data ? <QueryStatus status={query.isError ? "error" : "pending"} error={query.error} label="routing policy" onRetry={() => void query.refetch()} /> : <>
      <label className={styles.label} htmlFor="routing-policy-markdown">Markdown</label>
      <textarea id="routing-policy-markdown" className={styles.editor} value={text} disabled={draft.locked} spellCheck={false} onChange={event => draft.setPolicy(query.data!.routing_markdown, event.target.value)} />
      <p className={styles.meta}>{bytes.toLocaleString()} / {MAX_ROUTING_POLICY_BYTES.toLocaleString()} bytes</p>
      {bytes > MAX_ROUTING_POLICY_BYTES && <p className={styles.warning} role="alert">Policy must be at most 128 KiB in UTF-8.</p>}
    </>}
    {draft.feedback}
  </section>;
}
