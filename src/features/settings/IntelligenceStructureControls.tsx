import { createContext, useContext, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKey } from "../../api/queryKeys";
import { useSession } from "../../app/session";
import { readIntelligence, readIntelligenceStructure } from "../../api/intelligenceSettings";
import { MAX_ROUTING_POLICY_BYTES } from "../../api/intelligenceStructure";
import { useIntelligenceDraft } from "./IntelligenceDrafts";
import { ApiError } from "../../api/client";
import { inspectIntelligenceStructureSave, saveIntelligenceStructure, type IntelligenceStructure, type SaveIntelligenceStructure, type IntelligenceStructureSaved } from "../../api/intelligenceSettings";
import { ActionButton } from "../../components/layout/Workspace";
import { PARENT_NAMES, type ParentId } from "./IntelligenceGroups";
import styles from "./Intelligence.module.css";

export function useStructureSave(onSaved: (result: IntelligenceStructureSaved) => Promise<void>, onBusy: (value: boolean) => void) {
  const [pending, setPending] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState<SaveIntelligenceStructure | null>(null);
  const [retrySame, setRetrySame] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  async function run(request: SaveIntelligenceStructure, inspect = false) {
    if (pending) return false;
    let uncertain = false;
    setPending(true); onBusy(true); setError(null); setNotice(null);
    try {
      const result = await (inspect ? inspectIntelligenceStructureSave(request.operation_id) : saveIntelligenceStructure(request));
      await onSaved(result);
      setUnconfirmed(null); setConflict(false); setNotice(result.disposition === "unchanged" ? "No changes to save." : "Saved.");
      return true;
    } catch (error) {
      if (inspect) {
        uncertain = true; setUnconfirmed(request); setRetrySame(error instanceof ApiError && error.status === 404);
        setError(error instanceof ApiError && error.status === 404 ? "Save not recorded yet. Retry the same save safely." : "Save status is unavailable. Your edits are preserved.");
      } else if (error instanceof ApiError && error.status !== undefined && error.status >= 400 && error.status < 500) {
        setError(error.serverMessage ?? "The save was rejected."); setConflict(error.status === 409); setUnconfirmed(null);
      } else {
        uncertain = true; setUnconfirmed(request); setRetrySame(false); setError("Save unconfirmed. Check its status before editing again.");
      }
      return false;
    } finally { setPending(false); onBusy(uncertain); }
  }
  function reset() { setError(null); setNotice(null); setConflict(false); }
  const feedback = <>{notice && <span className={styles.success} role="status">{notice}</span>}{error && <div role="alert" className={styles.warning}>{error}{conflict && " Your edits are preserved. Load the latest settings before saving again."}</div>}
    {unconfirmed && <div className={styles.rowActions}><ActionButton disabled={pending} onClick={() => void run(unconfirmed, true)}>Check save status</ActionButton>{retrySame && <ActionButton disabled={pending} onClick={() => void run(unconfirmed)}>Retry same save</ActionButton>}</div>}</>;
  return { run, pending, locked: pending || unconfirmed !== null, conflict, reset, feedback };
}

type FieldDraft = { base: string; value: string };
type StructureDraftContext = {
  policy: FieldDraft | null; descriptions: Partial<Record<ParentId, FieldDraft>>; locked: boolean;
  setPolicy(base: string, value: string): void; setDescription(parent: ParentId, base: string, value: string): void;
  feedback: ReactNode;
};
const Context = createContext<StructureDraftContext | null>(null);
export function useStructureDraft() {
  const context = useContext(Context);
  if (!context) throw new Error("useStructureDraft outside StructureDraftProvider");
  return context;
}

/** Save all edited structure fields together against fresh metadata and assignments. */
export function StructureDraftProvider({ children }: { children: ReactNode }) {
  const { queryContext } = useSession(); const client = useQueryClient();
  const key = queryKey(queryContext, "intelligence-structure", {});
  const [policy, setPolicyState] = useState<FieldDraft | null>(null);
  const [descriptions, setDescriptions] = useState<Partial<Record<ParentId, FieldDraft>>>({});
  const [pending, setPending] = useState(false);
  const [unknown, setUnknown] = useState<SaveIntelligenceStructure | null>(null);
  const [retrySame, setRetrySame] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const dirty = !!policy || Object.keys(descriptions).length > 0;
  const invalid = !!policy && new TextEncoder().encode(policy.value).length > MAX_ROUTING_POLICY_BYTES || Object.values(descriptions).some(item => item && new TextEncoder().encode(item.value).length > 2000);
  const locked = pending || !!unknown;
  function setPolicy(base: string, value: string) { setPolicyState(old => { const initial = old?.base ?? base; return value === initial ? null : { base: initial, value }; }); setNotice(null); }
  function setDescription(parent: ParentId, base: string, value: string) {
    setDescriptions(old => { const initial = old[parent]?.base ?? base; const next = { ...old }; if (value === initial) delete next[parent]; else next[parent] = { base: initial, value }; return next; }); setNotice(null);
  }
  async function run(request: SaveIntelligenceStructure, inspect = false): Promise<boolean> {
    setPending(true); setError(null); setNotice(null);
    try {
      const result = await (inspect ? inspectIntelligenceStructureSave(request.operation_id) : saveIntelligenceStructure(request));
      client.setQueryData<IntelligenceStructure>(key, old => !old || BigInt(result.revision) >= BigInt(old.revision) ? result : old);
      setPolicyState(null); setDescriptions({}); setUnknown(null); setConflict(false); setRetrySame(false);
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
    if (!dirty) return true;
    if (locked || invalid || conflict) return false;
    setPending(true); setError(null); setNotice(null);
    try {
      const [latest, catalog] = await Promise.all([readIntelligenceStructure(), readIntelligence()]);
      const changed = (policy && latest.routing_markdown !== policy.base) || Object.entries(descriptions).some(([id, draft]) => latest.parents.find(parent => parent.id === id)?.description !== draft?.base);
      if (changed) { setConflict(true); setError("An edited field changed elsewhere. Your edits are preserved; reload to discard these edits."); return false; }
      const request: SaveIntelligenceStructure = { operation_id: crypto.randomUUID(), expected_revision: latest.revision, expected_catalog_revision: catalog.revision,
        routing_markdown: policy?.value ?? latest.routing_markdown, parents: latest.parents.map(parent => ({ ...parent, description: descriptions[parent.id]?.value ?? parent.description })), assignments: latest.assignments };
      return await run(request);
    } catch { setError("Could not load current settings. Your edits are preserved."); return false; }
    finally { setPending(false); }
  }
  const coordinator = useIntelligenceDraft({ id: "structure", label: "Routing policy and descriptions", dirty, locked: locked || invalid || conflict, save, order: 100 });
  const feedback = <>{notice && <p className={styles.success} role="status">{notice}</p>}{error && <p className={styles.warning} role="alert">{error}</p>}
    {conflict && <ActionButton disabled={pending} onClick={() => { setPending(true); void readIntelligenceStructure().then(latest => { client.setQueryData(key, latest); setPolicyState(null); setDescriptions({}); setConflict(false); setError(null); }).catch(() => setError("Could not reload settings. Your edits are preserved.")).finally(() => setPending(false)); }}>Reload structure settings</ActionButton>}
    {unknown && <div className={styles.rowActions}><ActionButton disabled={pending} onClick={() => void run(unknown, true)}>Check save status</ActionButton>{retrySame && <ActionButton disabled={pending} onClick={() => void run(unknown)}>Retry same save</ActionButton>}</div>}</>;
  return <Context.Provider value={{ policy, descriptions, locked: locked || coordinator.saving, setPolicy, setDescription, feedback }}>{children}</Context.Provider>;
}

export function ParentDescriptionEditor({ parent, structure }: {
  parent: ParentId; structure: IntelligenceStructure; catalogRevision: string; busy: boolean;
  onBusy(value: boolean): void; onSaved(result: IntelligenceStructureSaved): Promise<void>; onReload(): Promise<void>;
}) {
  const draft = useStructureDraft(); const name = PARENT_NAMES[parent];
  const base = structure.parents.find(item => item.id === parent)?.description ?? "";
  const description = draft.descriptions[parent]?.value ?? base;
  const tooLong = new TextEncoder().encode(description).length > 2000;
  return <div className={styles.parentHeader}>
    <label className={styles.parentDescription}><span>{name}</span><input aria-label={`${name} description`} maxLength={2000} disabled={draft.locked} value={description} onChange={event => draft.setDescription(parent, base, event.target.value)} /></label>
    {tooLong && <div className={styles.parentStatus}><p className={styles.warning} role="alert">Description must be at most 2,000 UTF-8 bytes.</p></div>}
  </div>;
}
