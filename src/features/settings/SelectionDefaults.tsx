import { useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isHttpClientError, ApiError } from "../../api/client";
import { queryKey } from "../../api/queryKeys";
import { FALLBACK_REASONS, problemsOf, problemText, ROLE_SETTINGS, saveSelectionDefaults, useSelectionDefaults, type Fence, type FallbackReason, type Problem, type SelectionDefaults as Defaults, type UnknownCost } from "../../api/roleSettings";
import { useSession } from "../../app/session";
import { ActionButton } from "../../components/layout/Workspace";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { useIntelligenceDraft } from "./IntelligenceDrafts";
import { TASK_ROUTE_PREFERENCES } from "../work/taskRouting";
import styles from "./ProfileDocuments.module.css";

const REASON_LABELS: Record<FallbackReason, string> = {
  missing_credentials: "Credentials are missing", unavailable: "The model is unavailable", unsupported: "The worker does not support it",
  stale_unknown: "Availability is stale or unknown", policy_denied: "Policy denies it",
};
/** The form's text for each value; numbers stay text until saved so a half-typed value is not lost. */
type Draft = Omit<Defaults, "max_attempts" | "max_lineage_elapsed_ms" | "observation_max_age_ms" | "max_cost_microunits" | "currency"> & {
  max_attempts: string; max_lineage_elapsed_ms: string; observation_max_age_ms: string; max_cost_microunits: string; currency: string;
};
const toDraft = (d: Defaults): Draft => ({ ...d, max_attempts: String(d.max_attempts), max_lineage_elapsed_ms: String(d.max_lineage_elapsed_ms), observation_max_age_ms: String(d.observation_max_age_ms),
  max_cost_microunits: d.max_cost_microunits === null ? "" : String(d.max_cost_microunits), currency: d.currency ?? "" });
const whole = (value: string) => /^\d{1,15}$/.test(value);
/** The values to send, or what to fix first. Bounds are the server's to judge; only what cannot be sent is caught here. */
function toDefaults(draft: Draft): Defaults | string {
  for (const key of ["max_attempts", "max_lineage_elapsed_ms", "observation_max_age_ms"] as const) if (!whole(draft[key])) return "Enter whole numbers for the attempts and both times.";
  if (draft.max_cost_microunits !== "" && !whole(draft.max_cost_microunits)) return "Enter the cost limit as a whole number, or leave it empty for no limit.";
  return { ...draft, fallback_on: FALLBACK_REASONS.filter(reason => draft.fallback_on.includes(reason)), max_attempts: Number(draft.max_attempts), max_lineage_elapsed_ms: Number(draft.max_lineage_elapsed_ms),
    observation_max_age_ms: Number(draft.observation_max_age_ms), max_cost_microunits: draft.max_cost_microunits === "" ? null : Number(draft.max_cost_microunits), currency: draft.currency.trim() === "" ? null : draft.currency.trim() };
}
function duration(ms: string): string {
  if (!whole(ms)) return "";
  const n = Number(ms), units: [number, string][] = [[3_600_000, "h"], [60_000, "min"], [1000, "s"]];
  const unit = units.find(([size]) => n >= size);
  return unit ? `${(n / unit[0]).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${unit[1]}` : `${n} ms`;
}
type Pending = Fence & { selection_defaults: Defaults };

/** The one selection policy every level starts from. A level overrides single values in its own document. */
export function SelectionDefaults() {
  const { bootstrap, queryContext } = useSession();
  const taskPreferences = bootstrap.capability(TASK_ROUTE_PREFERENCES).enabled;
  const client = useQueryClient();
  const query = useSelectionDefaults();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [retry, setRetry] = useState<Pending | null>(null);
  const id = useId();
  const saved = query.data;
  const current = draft ?? (saved ? toDraft(saved.selection_defaults) : null);
  const dirty = !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(toDraft(saved.selection_defaults));
  const edit = (patch: Partial<Draft>) => { if (current) { setDraft({ ...current, ...patch }); setNotice(null); setError(null); setProblems([]); setRetry(null); } };
  async function send(request: Pending): Promise<boolean> {
    if (saving) return false;
    setSaving(true); setNotice(null); setError(null); setProblems([]); setRetry(null);
    try {
      await saveSelectionDefaults(request);
      // Levels are compiled with these defaults, so every read of these Settings is refreshed.
      void client.invalidateQueries({ queryKey: queryKey(queryContext, ROLE_SETTINGS, {}).slice(0, 5) });
      await query.refetch();
      setDraft(null); setNotice("Saved.");
      return true;
    } catch (failure) {
      const status = failure instanceof ApiError ? failure.status : undefined;
      if (status === 409) { await query.refetch(); setError("The defaults changed since you opened them. Your edits are kept. Save again to replace the saved values, or discard your changes."); }
      else if (isHttpClientError(failure)) {
        const found = problemsOf(failure);
        if (found.length) setProblems(found); else setError(failure.serverMessage ?? "AQ refused these defaults.");
      } else { setRetry(request); setError("The save could not be confirmed. Your edits are kept. Retrying sends the same save again; AQ applies it once."); }
      return false;
    } finally { setSaving(false); }
  }
  async function save(): Promise<boolean> {
    if (!draft || !saved) return true;
    if (!dirty) return true;
    const values = toDefaults(draft);
    if (typeof values === "string") { setError(values); return false; }
    return send({ selection_defaults: values, expected_revision: saved.revision, operation_id: crypto.randomUUID() });
  }
  const coordinator = useIntelligenceDraft({ id: "selection-defaults", label: "selection defaults", dirty, locked: saving, save, order: 35 });
  const locked = saving || coordinator.saving;
  const number = (key: "max_attempts" | "max_lineage_elapsed_ms" | "observation_max_age_ms" | "max_cost_microunits", label: string, hint: string, optional = false) => current && <div className={styles.field}>
    <label htmlFor={`${id}-${key}`}>{label}</label>
    <input id={`${id}-${key}`} type="text" inputMode="numeric" value={current[key]} disabled={locked} aria-describedby={`${id}-${key}-hint`} aria-invalid={!(whole(current[key]) || (optional && current[key] === ""))} onChange={event => edit({ [key]: event.target.value.trim() })} />
    <span id={`${id}-${key}-hint`} className={styles.note}>{hint}</span>
  </div>;
  const check = (key: "allow_unknown_availability" | "require_complete_accounting" | "require_hard_cost_enforcement", label: string) => current && <label className={styles.switch}>
    <input type="checkbox" checked={current[key]} disabled={locked} onChange={event => edit({ [key]: event.target.checked })} />{label}</label>;
  return <section className={styles.documents} aria-labelledby={`${id}-heading`}>
    <div className={styles.toolbar}><div><h3 id={`${id}-heading`}>Selection defaults</h3>
      <p className={styles.meta}>How AQ picks among a level’s candidates and when it moves on to the next one. Every level uses these values unless its own document states another under “## Selection”.</p></div></div>
    {!saved || !current ? <QueryStatus status={query.isError ? "error" : "pending"} error={query.error} label="selection defaults" onRetry={() => void query.refetch()} /> : <div className={styles.form}>
      <div className={styles.fields}>
        {number("max_attempts", "Attempts per task", "How many candidates AQ may try for one task (1 to 32).")}
        {number("max_lineage_elapsed_ms", "Longest time across attempts (ms)", `${duration(current.max_lineage_elapsed_ms)} · at most 7 days`)}
        {number("observation_max_age_ms", "Oldest availability reading used (ms)", `${duration(current.observation_max_age_ms)} · between 1 s and 1 h`)}
        <div className={styles.field}><label htmlFor={`${id}-unknown-cost`}>When a candidate’s cost is unknown</label>
          <select id={`${id}-unknown-cost`} value={current.unknown_cost} disabled={locked} onChange={event => edit({ unknown_cost: event.target.value as UnknownCost })}>
            <option value="allow_bounded">Allow it, within the limits</option><option value="deny">Do not use it</option>
          </select></div>
        {number("max_cost_microunits", "Cost limit (millionths of the currency)", "Leave empty for no cost limit.", true)}
        <div className={styles.field}><label htmlFor={`${id}-currency`}>Currency of the cost limit</label>
          <input id={`${id}-currency`} type="text" value={current.currency} maxLength={3} disabled={locked} aria-describedby={`${id}-currency-hint`} spellCheck={false} onChange={event => edit({ currency: event.target.value.toUpperCase() })} />
          <span id={`${id}-currency-hint`} className={styles.note}>Three letters, such as USD. Given together with the cost limit.</span></div>
      </div>
      <fieldset className={styles.group} aria-describedby={taskPreferences ? `${id}-queue-fallback` : undefined}>
        <legend>Move on to the next candidate when</legend>
        {taskPreferences && <p id={`${id}-queue-fallback`} className={styles.meta}>
          Queued tasks can try another eligible provider when a preference can’t be met.
        </p>}
        <div className={styles.choices}>{FALLBACK_REASONS.map(reason => <label key={reason} className={styles.switch}>
          <input type="checkbox" checked={current.fallback_on.includes(reason)} disabled={locked} onChange={event => edit({ fallback_on: event.target.checked ? [...current.fallback_on, reason] : current.fallback_on.filter(item => item !== reason) })} />{REASON_LABELS[reason]}</label>)}</div>
      </fieldset>
      <fieldset className={styles.group}><legend>Availability and cost</legend>
        <div className={styles.choices}>
          {check("allow_unknown_availability", "Use a candidate whose availability is unknown")}
          {check("require_complete_accounting", "Require complete cost accounting")}
          {check("require_hard_cost_enforcement", "Require the cost limit to be enforced")}
        </div>
      </fieldset>
      <div className={styles.actions}>
        <ActionButton aria-label="Save selection defaults" disabled={locked || !dirty} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</ActionButton>
        {dirty && <ActionButton disabled={locked} onClick={() => { setDraft(null); setError(null); setProblems([]); setRetry(null); }}>Discard changes</ActionButton>}
        {retry && <ActionButton disabled={locked} onClick={() => void send(retry)}>Retry save</ActionButton>}
        {notice && <span className={styles.success} role="status">{notice}</span>}
      </div>
      {error && <p className={styles.warning} role="alert">{error}</p>}
      {problems.length > 0 && <div className={styles.problems} role="alert"><p>AQ did not save these defaults:</p><ul>{problems.map((problem, i) => <li key={i}>{problemText(problem)}</li>)}</ul></div>}
    </div>}
  </section>;
}
