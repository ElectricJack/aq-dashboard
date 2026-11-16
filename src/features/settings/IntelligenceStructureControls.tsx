import { createContext, useContext, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKey } from "../../api/queryKeys";
import { useSession } from "../../app/session";
import { ApiError } from "../../api/client";
import { inspectIntelligenceStructureSave, MAX_ROUTING_POLICY_BYTES, readIntelligenceStructure, saveIntelligenceStructure, type IntelligenceStructure, type SaveIntelligenceStructure } from "../../api/intelligenceStructure";
import { ActionButton } from "../../components/layout/Workspace";
import { useIntelligenceDraft } from "./IntelligenceDrafts";
import styles from "./Intelligence.module.css";

type FieldDraft = { base: string; value: string };
type StructureDraftContext = { policy: FieldDraft | null; locked: boolean; setPolicy(base: string, value: string): void; feedback: ReactNode };
const Context = createContext<StructureDraftContext | null>(null);
export function useStructureDraft() {
  const context = useContext(Context);
  if (!context) throw new Error("useStructureDraft outside StructureDraftProvider");
  return context;
}

/** The draft of the routing document. It is saved against fresh metadata, and everything else the structure record holds is sent back as read. */
export function StructureDraftProvider({ children }: { children: ReactNode }) {
  const { queryContext } = useSession(); const client = useQueryClient();
  const key = queryKey(queryContext, "intelligence-structure", {});
  const [policy, setPolicyState] = useState<FieldDraft | null>(null);
  const [pending, setPending] = useState(false);
  const [unknown, setUnknown] = useState<SaveIntelligenceStructure | null>(null);
  const [retrySame, setRetrySame] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const dirty = !!policy;
  const invalid = !!policy && new TextEncoder().encode(policy.value).length > MAX_ROUTING_POLICY_BYTES;
  const locked = pending || !!unknown;
  function setPolicy(base: string, value: string) { setPolicyState(old => { const initial = old?.base ?? base; return value === initial ? null : { base: initial, value }; }); setNotice(null); }
  async function run(request: SaveIntelligenceStructure, inspect = false): Promise<boolean> {
    setPending(true); setError(null); setNotice(null);
    try {
      const result = await (inspect ? inspectIntelligenceStructureSave(request.operation_id) : saveIntelligenceStructure(request));
      client.setQueryData<IntelligenceStructure>(key, old => !old || BigInt(result.revision) >= BigInt(old.revision) ? result : old);
      setPolicyState(null); setUnknown(null); setConflict(false); setRetrySame(false);
      setNotice(result.disposition === "unchanged" ? "No structure changes to save." : "Structure saved.");
      void client.invalidateQueries({ queryKey: key }); return true;
    } catch (e) {
      if (inspect) {
        setUnknown(request); setRetrySame(e instanceof ApiError && e.status === 404);
        setError(e instanceof ApiError && e.status === 404 ? "Save not recorded yet. Retry the same save safely." : "Save status is unavailable. Your edits are preserved.");
      } else if (e instanceof ApiError && e.status !== undefined && e.status >= 400 && e.status < 500) {
        setUnknown(null); setConflict(e.status === 409);
        setError(e.status === 409 ? "Settings changed during the save. Your edits are preserved; reload to discard these edits." : e.serverMessage ?? "Structure save was rejected. Your edits are preserved.");
      } else { setUnknown(request); setRetrySame(false); setError("Structure save unconfirmed. Check its status before editing again."); }
      return false;
    } finally { setPending(false); }
  }
  async function save(): Promise<boolean> {
    if (!policy) return true;
    if (locked || invalid || conflict) return false;
    setPending(true); setError(null); setNotice(null);
    try {
      const latest = await readIntelligenceStructure();
      if (latest.routing_markdown !== policy.base) { setConflict(true); setError("An edited field changed elsewhere. Your edits are preserved; reload to discard these edits."); return false; }
      return await run({ operation_id: crypto.randomUUID(), expected_revision: latest.revision, expected_catalog_revision: latest.catalog_revision,
        routing_markdown: policy.value, parents: latest.parents, assignments: latest.assignments });
    } catch { setError("Could not load current settings. Your edits are preserved."); return false; }
    finally { setPending(false); }
  }
  const coordinator = useIntelligenceDraft({ id: "structure", label: "Routing policy", dirty, locked: locked || invalid || conflict, save, order: 100 });
  const feedback = <>{notice && <p className={styles.success} role="status">{notice}</p>}{error && <p className={styles.warning} role="alert">{error}</p>}
    {conflict && <ActionButton disabled={pending} onClick={() => { setPending(true); void readIntelligenceStructure().then(latest => { client.setQueryData(key, latest); setPolicyState(null); setConflict(false); setError(null); }).catch(() => setError("Could not reload settings. Your edits are preserved.")).finally(() => setPending(false)); }}>Reload structure settings</ActionButton>}
    {unknown && <div className={styles.rowActions}><ActionButton disabled={pending} onClick={() => void run(unknown, true)}>Check save status</ActionButton>{retrySame && <ActionButton disabled={pending} onClick={() => void run(unknown)}>Retry same save</ActionButton>}</div>}</>;
  return <Context.Provider value={{ policy, locked: locked || coordinator.saving, setPolicy, feedback }}>{children}</Context.Provider>;
}
