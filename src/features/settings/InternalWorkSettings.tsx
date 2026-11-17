import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../../api/client";
import { INTERNAL_WORK_PURPOSES, inspectInternalWorkSave, readInternalWorkSettings, saveInternalWorkSettings, type InternalWorkPurpose, type InternalWorkSettings as Settings, type SaveInternalWork } from "../../api/internalWork";
import { queryKey } from "../../api/queryKeys";
import { useDocuments } from "../../api/roleSettings";
import { useSession } from "../../app/session";
import { ActionButton } from "../../components/layout/Workspace";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import styles from "./InternalWorkSettings.module.css";

const PURPOSE_LABELS: Record<InternalWorkPurpose, string> = {
  routing_classification: "Routing classification", playbook_compilation: "Playbook compilation", playbook_call: "Playbook calls",
  decision_revision: "Decision revision", result_processing: "Result processing",
};
type Draft = { default_profile_id: string; overrides: Partial<Record<InternalWorkPurpose, string>> };

function ProfileSelect({ id, label, value, onChange, profiles, first }: { id: string; label: string; value: string; onChange(value: string): void; profiles: { id: string; name: string }[]; first: string }) {
  const known = value === "" || profiles.some(p => p.id === value);
  return <div className={styles.field}><label htmlFor={id}>{label}</label>
    <select id={id} className={styles.select} value={value} onChange={event => onChange(event.target.value)}>
      <option value="">{first}</option>
      {!known && <option value={value}>{value} (unavailable)</option>}
      {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  </div>;
}

export function InternalWorkSettings() {
  const { queryContext } = useSession();
  const client = useQueryClient();
  const settingsKey = queryKey(queryContext, "internal-work-settings", {});
  const query = useQuery({ queryKey: settingsKey, queryFn: ({ signal }) => readInternalWorkSettings(signal), retry: false });
  const levels = useDocuments("intelligence");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState<SaveInternalWork | null>(null);
  const [retrySame, setRetrySame] = useState(false);
  const [conflict, setConflict] = useState(false);
  const saved = query.data;
  // Every saved level may be chosen; one whose text AQ cannot read is listed by its id.
  const profiles = (levels.data?.documents ?? []).map(level => ({ id: level.id, name: level.fields?.name || level.id }));
  const current: Draft | null = draft ?? (saved ? { default_profile_id: saved.default_profile_id ?? "", overrides: saved.overrides } : null);
  const edit = (change: (value: Draft) => Draft) => { if (current && !unconfirmed) { setDraft(change(current)); setNotice(null); } };
  async function run(request: SaveInternalWork, inspect = false) {
    if (saving) return;
    setSaving(true); setNotice(null); setError(null);
    try {
      const result = await (inspect ? inspectInternalWorkSave(request.operation_id) : saveInternalWorkSettings(request));
      client.setQueryData(settingsKey, { revision: result.revision, default_profile_id: result.default_profile_id, overrides: result.overrides, purposes: result.purposes });
      setDraft(null); setUnconfirmed(null); setConflict(false); setRetrySame(false);
      setNotice(result.disposition === "unchanged" ? "No changes to save." : "Saved.");
    } catch (failure) {
      const status = failure instanceof ApiError ? failure.status : undefined;
      if (inspect) {
        setUnconfirmed(request); setRetrySame(status === 404);
        setError(status === 404 ? "Save not recorded yet. Retry the same save safely." : "Save status is unavailable. Your edits are preserved.");
      } else if (status !== undefined && status >= 400 && status < 500) {
        setUnconfirmed(null); setConflict(status === 409);
        setError(status === 409 ? "Settings changed elsewhere. Reload to continue." : failure instanceof ApiError ? failure.serverMessage ?? "The save was rejected." : "The save was rejected.");
      } else {
        // The response was lost: the save may have committed. Ask the server by operation id.
        setUnconfirmed(request); setSaving(false); void run(request, true); return;
      }
    } finally { setSaving(false); }
  }
  function save(base: Settings, value: Draft) {
    if (unconfirmed) return void run(unconfirmed);
    const overrides = Object.fromEntries(Object.entries(value.overrides).filter(([, id]) => id)) as Draft["overrides"];
    void run({ operation_id: crypto.randomUUID(), expected_revision: base.revision, default_profile_id: value.default_profile_id || null, overrides });
  }
  return <section className={styles.section} aria-labelledby="internal-work-heading">
    <h3 id="internal-work-heading">Internal work</h3>
    <p className={styles.meta}>The intelligence profile used for AQ's own background work. A purpose can override the default.</p>
    {!saved || !current ? <QueryStatus status={query.isError ? "error" : "pending"} error={query.error} label="internal work settings" onRetry={() => void query.refetch()} /> : <>
      {!current.default_profile_id && <p className={styles.warning}>No profile is set. Internal work will fail until one is chosen.</p>}
      <div className={styles.fields}>
        <ProfileSelect id="internal-work-default" label="Default profile" value={current.default_profile_id} profiles={profiles} first="Choose a profile"
          onChange={id => edit(value => ({ ...value, default_profile_id: id }))} />
        {INTERNAL_WORK_PURPOSES.map(purpose => <ProfileSelect key={purpose} id={`internal-work-${purpose}`} label={PURPOSE_LABELS[purpose]} value={current.overrides[purpose] ?? ""} profiles={profiles} first="Use default"
          onChange={id => edit(value => ({ ...value, overrides: { ...value.overrides, [purpose]: id } }))} />)}
      </div>
      <div className={styles.actions}>
        <ActionButton aria-label="Save internal work" disabled={saving || !draft} onClick={() => void save(saved, current)}>Save</ActionButton>
        {conflict && <ActionButton disabled={saving} onClick={() => { setDraft(null); setError(null); setConflict(false); void query.refetch(); }}>Reload</ActionButton>}
        {unconfirmed && <ActionButton disabled={saving} onClick={() => void run(unconfirmed, true)}>Check save status</ActionButton>}
        {unconfirmed && retrySame && <ActionButton disabled={saving} onClick={() => void run(unconfirmed)}>Retry same save</ActionButton>}
        {notice && <span className={styles.success} role="status">{notice}</span>}
      </div>
      {error && <p className={styles.warning} role="alert">{error}</p>}
    </>}
  </section>;
}
