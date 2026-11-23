import { createContext, useContext, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKey } from "../../api/queryKeys";
import { useSession } from "../../app/session";
import { isHttpClientError, ApiError } from "../../api/client";
import { inspectRoutingDocumentSave, readRoutingDocument, saveRoutingDocument, type RoutingDocument, type SaveRoutingDocument } from "../../api/routingDocument";
import { useProfileLimits } from "../../api/roleSettings";
import { ActionButton } from "../../components/layout/Workspace";
import { useIntelligenceDraft } from "./IntelligenceDrafts";
import styles from "./Intelligence.module.css";

/** Every read of the routing document shares this resource name. */
export const ROUTING_DOCUMENT = "routing-document";
type FieldDraft = { base: string; value: string };
type RoutingDraftContext = { policy: FieldDraft | null; locked: boolean; /** The bytes one document may have (Settings → Limits); null while that is not known, and then only AQ checks the size. */ limit: number | null; setPolicy(base: string, value: string): void; feedback: ReactNode };
const Context = createContext<RoutingDraftContext | null>(null);
export function useRoutingDocumentDraft() {
  const context = useContext(Context);
  if (!context) throw new Error("useRoutingDocumentDraft outside RoutingDocumentDraftProvider");
  return context;
}

/** The draft of the routing document. It is saved at the revision read just before the save, and only when the saved text is still the one the edit started from. */
function keepLatest(old: RoutingDocument | undefined, result: RoutingDocument) {
  if (old && BigInt(old.revision) > BigInt(result.revision)) return old;
  return { markdown: result.markdown, revision: result.revision };
}

export function RoutingDocumentDraftProvider({ children }: { children: ReactNode }) {
  const { queryContext } = useSession(); const client = useQueryClient();
  const key = queryKey(queryContext, ROUTING_DOCUMENT, {});
  const [policy, setPolicyState] = useState<FieldDraft | null>(null);
  const [pending, setPending] = useState(false);
  const [unknown, setUnknown] = useState<SaveRoutingDocument | null>(null);
  const [retrySame, setRetrySame] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const dirty = !!policy;
  // The server holds the routing document to the store's limit for one document.
  const limit = useProfileLimits().data?.limits.documents.max_document_bytes ?? null;
  const invalid = !!policy && limit !== null && new TextEncoder().encode(policy.value).length > limit;
  const locked = pending || !!unknown;
  function setPolicy(base: string, value: string) { setPolicyState(old => { const initial = old?.base ?? base; return value === initial ? null : { base: initial, value }; }); setNotice(null); }
  async function run(request: SaveRoutingDocument, inspect = false): Promise<boolean> {
    setPending(true); setError(null); setNotice(null);
    try {
      const result = await (inspect ? inspectRoutingDocumentSave(request.operation_id) : saveRoutingDocument(request));
      client.setQueryData<RoutingDocument>(key, old => keepLatest(old, result));
      setPolicyState(null); setUnknown(null); setConflict(false); setRetrySame(false);
      setNotice(result.disposition === "unchanged" ? "The routing document was already saved as written." : "Routing document saved.");
      void client.invalidateQueries({ queryKey: key }); return true;
    } catch (e) {
      if (inspect) {
        const missing = e instanceof ApiError && e.status === 404;
        setUnknown(request); setRetrySame(missing);
        setError(missing ? "Save not recorded yet. Retry the same save safely." : "Save status is unavailable. Your edits are preserved.");
      } else if (isHttpClientError(e)) {
        setUnknown(null); setConflict(e.status === 409);
        setError(e.status === 409 ? "Settings changed during the save. Your edits are preserved; reload to discard these edits." : e.serverMessage ?? "AQ refused the routing document. Your edits are preserved.");
      } else { setUnknown(request); setRetrySame(false); setError("The routing document save is unconfirmed. Check its status before editing again."); }
      return false;
    } finally { setPending(false); }
  }
  const saveLocked = locked || invalid || conflict;
  async function save(): Promise<boolean> {
    if (!policy) return true;
    if (saveLocked) return false;
    setPending(true); setError(null); setNotice(null);
    try {
      const latest = await readRoutingDocument();
      if (latest.markdown !== policy.base) { setConflict(true); setError("An edited field changed elsewhere. Your edits are preserved; reload to discard these edits."); return false; }
      return await run({ operation_id: crypto.randomUUID(), expected_revision: latest.revision, markdown: policy.value });
    } catch { setError("Could not load current settings. Your edits are preserved."); return false; }
    finally { setPending(false); }
  }
  const coordinator = useIntelligenceDraft({ id: "routing-document", label: "Routing policy", dirty, locked: saveLocked, save, order: 100 });
  const feedback = <>{notice && <p className={styles.success} role="status">{notice}</p>}{error && <p className={styles.warning} role="alert">{error}</p>}
    {conflict && <ActionButton disabled={pending} onClick={() => { setPending(true); void readRoutingDocument().then(latest => { client.setQueryData(key, latest); setPolicyState(null); setConflict(false); setError(null); }).catch(() => setError("Could not reload settings. Your edits are preserved.")).finally(() => setPending(false)); }}>Reload the routing document</ActionButton>}
    {unknown && <div className={styles.rowActions}><ActionButton disabled={pending} onClick={() => void run(unknown, true)}>Check save status</ActionButton>{retrySame && <ActionButton disabled={pending} onClick={() => void run(unknown)}>Retry same save</ActionButton>}</div>}</>;
  return <Context.Provider value={{ policy, locked: locked || coordinator.saving, limit, setPolicy, feedback }}>{children}</Context.Provider>;
}
