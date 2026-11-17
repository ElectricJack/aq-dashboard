import { useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../../api/client";
import { queryKey } from "../../api/queryKeys";
import { DOCUMENT_LIMIT_KEYS, problemsOf, problemText, ROLE_SETTINGS, saveProfileLimits, useProfileLimits, type Fence, type Problem, type ProfileLimits } from "../../api/roleSettings";
import { useSession } from "../../app/session";
import { ActionButton } from "../../components/layout/Workspace";
import { useIntelligenceDraft } from "./IntelligenceDrafts";
import styles from "./ProfileDocuments.module.css";

/** The limits of the store that holds roles, levels and execution profiles (`/api/settings/profiles/limits`), in the order shown. */
const FIELDS = [
  ["max_document_bytes", "One document (bytes)", "The largest a single role, level or execution profile may be."],
  ["max_set_bytes", "All documents together (bytes)", "The largest all documents may be in total."],
  ["max_documents_per_kind", "Documents of one kind", "How many roles, how many levels and how many execution profiles there may be."],
  ["max_name_bytes", "A name (bytes)", "The longest name a document may have."],
  ["max_description_bytes", "A description (bytes)", "The longest description a document may have."],
  ["snapshots_kept", "Snapshots kept", "How many earlier snapshots AQ keeps besides those an attempt still uses."],
  ["operations_kept", "Saves remembered", "How many recent saves AQ remembers, so a repeated save is applied once."],
] as const;
type Key = typeof FIELDS[number][0];
type Draft = Record<Key, string>;
const isDocumentKey = (key: Key): key is typeof DOCUMENT_LIMIT_KEYS[number] => (DOCUMENT_LIMIT_KEYS as readonly string[]).includes(key);
const toDraft = (limits: ProfileLimits) => Object.fromEntries(FIELDS.map(([key]) => [key, String(isDocumentKey(key) ? limits.documents[key] : limits[key])])) as Draft;
const whole = (value: string) => /^\d{1,15}$/.test(value);
function toLimits(draft: Draft): ProfileLimits {
  const documents = Object.fromEntries(DOCUMENT_LIMIT_KEYS.map(key => [key, Number(draft[key])])) as ProfileLimits["documents"];
  return { documents, snapshots_kept: Number(draft.snapshots_kept), operations_kept: Number(draft.operations_kept) };
}
type Pending = Fence & { limits: ProfileLimits };

/**
 * The store's limits, behind a disclosure beside the snapshot line. `scope` names the tab it is shown on: each tab keeps
 * its own unsaved entries, and all of them read and save the same limits.
 */
export function ProfileStoreLimits({ scope }: { scope: string }) {
  const { queryContext } = useSession();
  const client = useQueryClient();
  const query = useProfileLimits();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [retry, setRetry] = useState<Pending | null>(null);
  const id = useId();
  const saved = query.data;
  const current = draft ?? (saved ? toDraft(saved.limits) : null);
  const dirty = !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(toDraft(saved.limits));
  const invalid = !!current && FIELDS.some(([key]) => !whole(current[key]));
  const edit = (key: Key, value: string) => { if (current) { setDraft({ ...current, [key]: value }); setNotice(null); setError(null); setProblems([]); setRetry(null); } };
  async function send(request: Pending): Promise<boolean> {
    if (saving) return false;
    setSaving(true); setNotice(null); setError(null); setProblems([]); setRetry(null);
    try {
      await saveProfileLimits(request);
      // The limits decide what a document may be, so every read of these Settings is refreshed.
      void client.invalidateQueries({ queryKey: queryKey(queryContext, ROLE_SETTINGS, {}).slice(0, 5) });
      await query.refetch();
      setDraft(null); setNotice("Saved.");
      return true;
    } catch (failure) {
      const status = failure instanceof ApiError ? failure.status : undefined;
      if (status === 409) { await query.refetch(); setError("The limits changed since you opened them. Your entries are kept. Save again to replace the saved values, or discard your changes."); }
      else if (status !== undefined && status >= 400 && status < 500) {
        const found = problemsOf(failure);
        if (found.length) setProblems(found); else setError((failure as ApiError).serverMessage ?? "AQ refused these limits.");
      } else { setRetry(request); setError("The save could not be confirmed. Your entries are kept. Retrying sends the same save again; AQ applies it once."); }
      return false;
    } finally { setSaving(false); }
  }
  async function save(): Promise<boolean> {
    if (!dirty || !draft || !saved) return true;
    if (invalid) { setError("Enter every limit as a whole number."); return false; }
    return send({ limits: toLimits(draft), expected_revision: saved.revision, operation_id: crypto.randomUUID() });
  }
  const coordinator = useIntelligenceDraft({ id: `profile-limits:${scope}`, label: "limits", dirty, locked: saving, save, order: 90 });
  const locked = saving || coordinator.saving;
  if (!saved || !current) return query.isError ? <p className={styles.note} role="status">The limits of roles, levels and execution profiles could not be read.</p> : null;
  return <details className={styles.limitsForm}>
    <summary>Limits{dirty ? " · unsaved changes" : ""}</summary>
    <div className={styles.form} role="group" aria-label="Limits of roles, levels and execution profiles">
      <p className={styles.note}>These limits apply to roles, levels and execution profiles alike. AQ refuses a limit that the saved documents already exceed.</p>
      <div className={styles.fields}>{FIELDS.map(([key, label, hint]) => <div key={key} className={styles.field}>
        <label htmlFor={`${id}-${key}`}>{label}</label>
        <input id={`${id}-${key}`} type="text" inputMode="numeric" value={current[key]} disabled={locked} aria-describedby={`${id}-${key}-hint`} aria-invalid={!whole(current[key])} onChange={event => edit(key, event.target.value.trim())} />
        <span id={`${id}-${key}-hint`} className={styles.note}>{hint}</span>
      </div>)}</div>
      <div className={styles.actions}>
        <ActionButton aria-label="Save limits" disabled={locked || !dirty} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</ActionButton>
        {dirty && <ActionButton disabled={locked} onClick={() => { setDraft(null); setError(null); setProblems([]); setRetry(null); }}>Discard changes</ActionButton>}
        {retry && <ActionButton disabled={locked} onClick={() => void send(retry)}>Retry save</ActionButton>}
        {notice && <span className={styles.success} role="status">{notice}</span>}
      </div>
      {error && <p className={styles.warning} role="alert">{error}</p>}
      {problems.length > 0 && <div className={styles.problems} role="alert"><p>AQ did not save these limits:</p><ul>{problems.map((problem, i) => <li key={i}>{problemText(problem)}</li>)}</ul></div>}
    </div>
  </details>;
}
