import { useState } from "react";
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
    if (pending) return;
    let uncertain = false;
    setPending(true); onBusy(true); setError(null); setNotice(null);
    try {
      const result = await (inspect ? inspectIntelligenceStructureSave(request.operation_id) : saveIntelligenceStructure(request));
      await onSaved(result);
      setUnconfirmed(null); setConflict(false); setNotice(result.disposition === "unchanged" ? "No changes to save." : "Saved.");
    } catch (error) {
      if (inspect) {
        uncertain = true; setUnconfirmed(request); setRetrySame(error instanceof ApiError && error.status === 404);
        setError(error instanceof ApiError && error.status === 404 ? "Save not recorded yet. Retry the same save safely." : "Save status is unavailable. Your edits are preserved.");
      } else if (error instanceof ApiError && error.status !== undefined && error.status >= 400 && error.status < 500) {
        setError(error.serverMessage ?? "The save was rejected."); setConflict(error.status === 409); setUnconfirmed(null);
      } else {
        uncertain = true; setUnconfirmed(request); setRetrySame(false); setError("Save unconfirmed. Check its status before editing again.");
      }
    } finally { setPending(false); onBusy(uncertain); }
  }
  function reset() { setError(null); setNotice(null); setConflict(false); }
  const feedback = <>{notice && <span className={styles.success} role="status">{notice}</span>}{error && <div role="alert" className={styles.warning}>{error}{conflict && " Your edits are preserved. Load the latest settings before saving again."}</div>}
    {unconfirmed && <div className={styles.rowActions}><ActionButton disabled={pending} onClick={() => void run(unconfirmed, true)}>Check save status</ActionButton>{retrySame && <ActionButton disabled={pending} onClick={() => void run(unconfirmed)}>Retry same save</ActionButton>}</div>}</>;
  return { run, pending, locked: pending || unconfirmed !== null, conflict, reset, feedback };
}

export function ParentDescriptionEditor({ parent, structure, catalogRevision, busy, onBusy, onSaved, onReload }: {
  parent: ParentId; structure: IntelligenceStructure; catalogRevision: string; busy: boolean;
  onBusy(value: boolean): void; onSaved(result: IntelligenceStructureSaved): Promise<void>; onReload(): Promise<void>;
}) {
  const [draft, setDraft] = useState<{ structure: IntelligenceStructure; catalogRevision: string; description: string } | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const operation = useStructureSave(async result => { await onSaved(result); setDraft(null); }, onBusy);
  const description = draft?.description ?? structure.parents.find(item => item.id === parent)?.description ?? "";
  const name = PARENT_NAMES[parent];
  const tooLong = new TextEncoder().encode(description).length > 2000;
  return <div className={styles.parentHeader}>
    <h3>{name}</h3>
    <label className={styles.parentDescription}>{name} description<input aria-label={`${name} description`} maxLength={2000} disabled={operation.locked} value={description} onChange={event => {
      setDraft(old => ({ structure: old?.structure ?? structuredClone(structure), catalogRevision: old?.catalogRevision ?? catalogRevision, description: event.target.value })); operation.reset();
    }} /></label>
    <div className={styles.rowActions}><ActionButton aria-label={`Save ${name} description`} disabled={busy || operation.locked || operation.conflict || !draft || tooLong} onClick={() => {
      if (!draft) return;
      void operation.run({ operation_id: crypto.randomUUID(), expected_revision: draft.structure.revision, expected_catalog_revision: draft.catalogRevision,
        parents: draft.structure.parents.map(item => item.id === parent ? { ...item, description: draft.description } : item), assignments: draft.structure.assignments, routing_markdown: draft.structure.routing_markdown });
    }}> {operation.pending ? "Saving…" : "Save"}</ActionButton>
      {draft && !operation.locked && <ActionButton aria-label={`Reset ${name} description`} onClick={() => { setResetError(null); void onReload().then(() => { setDraft(null); operation.reset(); }).catch(() => setResetError("Could not reload settings. Your edits are preserved.")); }}>Reset</ActionButton>}
    </div>
    <div className={styles.parentStatus}>{resetError && <p className={styles.warning} role="alert">{resetError}</p>}{tooLong && <p className={styles.warning} role="alert">Description must be at most 2,000 UTF-8 bytes.</p>}{operation.feedback}</div>
  </div>;
}
