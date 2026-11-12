import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../../api/client";
import { inspectIntelligenceStructureSave, readIntelligenceStructure, saveIntelligenceStructure, type IntelligenceStructure, type SaveIntelligenceStructure } from "../../api/intelligenceSettings";
import { MAX_ROUTING_POLICY_BYTES } from "../../api/intelligenceStructure";
import { queryKey } from "../../api/queryKeys";
import { useSession } from "../../app/session";
import { ActionButton } from "../../components/layout/Workspace";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import styles from "./RoutingPolicyEditor.module.css";

const MAX_BYTES = MAX_ROUTING_POLICY_BYTES;

type Draft = { text: string; base: IntelligenceStructure };

export function RoutingPolicyEditor() {
  const { queryContext } = useSession();
  const key = queryKey(queryContext, "intelligence-structure", {});
  const client = useQueryClient();
  const query = useQuery({ queryKey: key, queryFn: ({ signal }) => readIntelligenceStructure(signal), retry: false });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState(false);
  const [unknown, setUnknown] = useState<SaveIntelligenceStructure | null>(null);
  const [retrySame, setRetrySame] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const text = draft?.text ?? query.data?.routing_markdown ?? "";
  const bytes = new TextEncoder().encode(text).length;

  async function run(request: SaveIntelligenceStructure, inspect = false) {
    if (pending) return;
    setPending(true); setMessage(null); setNotice(null);
    try {
      const result = await (inspect ? inspectIntelligenceStructureSave(request.operation_id) : saveIntelligenceStructure(request));
      client.setQueryData<IntelligenceStructure>(key, old => !old || BigInt(result.revision) >= BigInt(old.revision) ? result : old);
      setDraft(null); setUnknown(null); setConflict(false); setRetrySame(false);
      setNotice(result.disposition === "unchanged" ? "No changes to save." : "Saved.");
      void client.invalidateQueries({ queryKey: key });
    } catch (error) {
      if (inspect) {
        setUnknown(request);
        setRetrySame(error instanceof ApiError && error.status === 404);
        setMessage(error instanceof ApiError && error.status === 404 ? "Save not recorded yet. Retry the same save safely." : "Save status is unavailable. Your draft is preserved.");
      } else if (error instanceof ApiError && error.status !== undefined && error.status >= 400 && error.status < 500) {
        setUnknown(null); setConflict(error.status === 409);
        setMessage(error.status === 409 ? "Settings changed while you were editing. Your draft is preserved; reload to discard it and load the latest settings." : error.serverMessage ?? "The policy could not be saved. Your draft is preserved.");
      } else {
        setUnknown(request); setRetrySame(false);
        setMessage("Save unconfirmed. Check its status before editing again.");
      }
    } finally { setPending(false); }
  }
  async function reset() {
    setPending(true); setMessage(null); setNotice(null);
    const result = await query.refetch();
    if (result.isSuccess) { setDraft(null); setConflict(false); }
    else setMessage("Could not reload settings. Your draft is preserved.");
    setPending(false);
  }
  return <section className={styles.section} aria-labelledby="routing-policy-heading">
    <h3 id="routing-policy-heading">Routing policy</h3>
    <p className={styles.meta}>Saved policy source; playbook execution will be connected later.</p>
    {!query.data ? <QueryStatus status={query.isError ? "error" : "pending"} error={query.error} label="routing policy" onRetry={() => void query.refetch()} /> : <>
      <label className={styles.label} htmlFor="routing-policy-markdown">Markdown</label>
      <textarea id="routing-policy-markdown" className={styles.editor} value={text} disabled={pending || !!unknown} spellCheck={false} onChange={event => {
        setDraft(old => ({ text: event.target.value, base: old?.base ?? structuredClone(query.data!) })); setNotice(null);
      }} />
      <p className={styles.meta}>{bytes.toLocaleString()} / {MAX_BYTES.toLocaleString()} bytes</p>
      {bytes > MAX_BYTES && <p className={styles.warning} role="alert">Policy must be at most 128 KiB in UTF-8.</p>}
      {message && <p className={styles.warning} role="alert">{message}</p>}
      {notice && <p className={styles.success} role="status">{notice}</p>}
      <div className={styles.actions}>
        <ActionButton disabled={!draft || bytes > MAX_BYTES || pending || !!unknown || conflict} onClick={() => {
          if (!draft) return;
          void run({ operation_id: crypto.randomUUID(), expected_revision: draft.base.revision, expected_catalog_revision: draft.base.catalog_revision,
            routing_markdown: draft.text, parents: draft.base.parents, assignments: draft.base.assignments });
        }}>{pending && !unknown ? "Saving…" : "Save"}</ActionButton>
        <ActionButton disabled={pending || !!unknown || (!draft && !message)} onClick={() => void reset()}>{conflict ? "Reload settings" : "Reset"}</ActionButton>
        {unknown && <ActionButton disabled={pending} onClick={() => void run(unknown, true)}>Check save status</ActionButton>}
        {unknown && retrySame && <ActionButton disabled={pending} onClick={() => void run(unknown)}>Retry same save</ActionButton>}
      </div>
    </>}
  </section>;
}
