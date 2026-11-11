import { Fragment, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { ApiError } from "../../api/client";
import { inspectIntelligenceSave, readIntelligence, saveIntelligence, type Candidate, type IntelligenceProfile, type IntelligenceSettings, type ModelChoice, type SaveIntelligence, type IntelligenceSaved } from "../../api/intelligenceSettings";
import { queryKey } from "../../api/queryKeys";
import { useSession } from "../../app/session";
import { ActionButton } from "../../components/layout/Workspace";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { RetainedNotice } from "../../components/QueryStatus/RetainedNotice";
import styles from "./Intelligence.module.css";

const PROVIDERS: Record<string, string> = { anthropic: "Anthropic", openai: "OpenAI", google: "Google", ollama: "Ollama", opencode: "OpenCode", longcat: "LongCat", nemotron: "Nemotron" };
const modelKey = (c: Pick<ModelChoice, "provider" | "model">) => `${c.provider}:${c.model}`;
function choiceFor(candidate: Candidate | undefined, choices: ModelChoice[]) {
  return candidate && choices.find(c => c.provider === candidate.provider && c.model === candidate.model
    && c.reasoning_configuration_reference === candidate.reasoning_configuration_reference && candidate.harnesses.includes(c.harness));
}
function errorMessage(error: unknown) {
  return error instanceof ApiError ? error.serverMessage ?? "The save could not be confirmed." : "The save could not be confirmed.";
}
function ProfileRow({ profile, settings, provider, busy, onBusy, onSaved, onRemove, onReload }: {
  profile: IntelligenceProfile; settings: IntelligenceSettings; provider: string; busy: boolean;
  onBusy(value: boolean): void; onSaved(result: IntelligenceSaved): Promise<void>; onRemove(): void; onReload(): Promise<void>;
}) {
  const [name, setName] = useState(profile.name ?? profile.id);
  const [description, setDescription] = useState(profile.description ?? "");
  const [candidates, setCandidates] = useState(() => structuredClone(profile.candidates));
  const [version, setVersion] = useState(profile.version);
  const [dirty, setDirty] = useState(profile.version === 0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState<SaveIntelligence | null>(null);
  const [retrySame, setRetrySame] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (confirmDelete) { confirmButton.current?.focus(); confirmButton.current?.scrollIntoView?.({ block: "center", inline: "nearest" }); } }, [confirmDelete]);
  const locked = pending || unconfirmed !== null;
  // A clean row follows refreshed server data; an edited row keeps its draft.
  const shownName = dirty ? name : profile.name ?? profile.id;
  const shownDescription = dirty ? description : profile.description ?? "";
  const shownCandidates = dirty ? candidates : profile.candidates;
  const shownVersion = dirty ? version : profile.version;
  const candidate = shownCandidates.find(c => c.provider === provider);
  const choices = settings.model_choices.filter(c => c.provider === provider);
  const models = choices.filter((c, i, all) => all.findIndex(other => other.model === c.model) === i);
  const configured = choiceFor(candidate, choices);
  const variants = choices.filter(c => c.model === candidate?.model);
  const reasoning = [...(configured ? [configured] : []), ...variants].filter((c, i, all) => all.findIndex(other => other.reasoning === c.reasoning && other.harness === c.harness) === i);
  function beginEdit() {
    if (!dirty) { setName(shownName); setDescription(shownDescription); setCandidates(structuredClone(shownCandidates)); setVersion(shownVersion); }
    setDirty(true); setNotice(null);
  }
  function setChoice(choice: ModelChoice | null) {
    beginEdit();
    const otherProviders = shownCandidates.filter(c => c.provider !== provider && c.provider !== "configuration-required");
    setCandidates(choice ? [...otherProviders, { id: candidate?.id ?? `choice-${crypto.randomUUID()}`, provider: choice.provider,
      model: choice.model, reasoning_configuration_reference: choice.reasoning_configuration_reference, harnesses: [choice.harness] }] : otherProviders);
  }
  async function complete(result: IntelligenceSaved) {
    setName(result.profile.name ?? result.profile.id); setDescription(result.profile.description ?? "");
    setCandidates(structuredClone(result.profile.candidates)); setVersion(result.profile.version);
    await onSaved(result); setDirty(false); setUnconfirmed(null); setError(null); setConflict(false);
    setNotice(result.disposition === "unchanged" ? "No changes to save." : "Saved.");
  }
  async function send(request: SaveIntelligence) {
    if (pending) return;
    setPending(true); setPendingDelete(request.delete === true); setConfirmDelete(false); onBusy(true); setError(null); setNotice(null); setConflict(false);
    try { await complete(await saveIntelligence(request)); }
    catch (e) {
      if (e instanceof ApiError && e.status !== undefined && e.status >= 400 && e.status < 500) {
        setError(errorMessage(e)); setConflict(e.status === 409 && !request.delete); setUnconfirmed(null);
      } else {
        setUnconfirmed(request); setRetrySame(false); setError(`${request.delete ? "Delete" : "Save"} unconfirmed. Check its status before editing this row again.`);
      }
    } finally { setPending(false); setPendingDelete(false); onBusy(false); }
  }
  async function check() {
    if (!unconfirmed || pending) return;
    setPending(true); onBusy(true);
    try { await complete(await inspectIntelligenceSave(unconfirmed.operation_id)); }
    catch (e) {
      setRetrySame(e instanceof ApiError && e.status === 404);
      setError(e instanceof ApiError && e.status === 404 ? "Save not recorded yet. Retry the same save safely." : "Save status is unavailable. This row is preserved.");
    } finally { setPending(false); onBusy(false); }
  }
  const label = shownName.trim() || "new profile";
  return <Fragment>
    <tr aria-label={label} data-profile-id={profile.id}>
      <td><input aria-label="Profile name" value={shownName} required maxLength={128} disabled={locked} onChange={e => { beginEdit(); setName(e.target.value); }} /></td>
      <td><input aria-label="Description" value={shownDescription} maxLength={2000} disabled={locked} onChange={e => { beginEdit(); setDescription(e.target.value); }} /></td>
      <td><select aria-label="Model" value={candidate ? modelKey(candidate) : ""} disabled={locked || models.length === 0} onChange={e => setChoice(models.find(c => modelKey(c) === e.target.value) ?? null)}>
        <option value="">Not set</option>
        {candidate && !models.some(c => c.model === candidate.model) && <option value={modelKey(candidate)}>{candidate.model} (not configured)</option>}
        {models.map(c => <option key={modelKey(c)} value={modelKey(c)}>{c.model}</option>)}
      </select></td>
      <td><select aria-label="Reasoning effort" value={configured ? `${configured.reasoning_configuration_reference}:${configured.harness}` : ""} disabled={locked || reasoning.length === 0} onChange={e => {
        const choice = reasoning.find(c => `${c.reasoning_configuration_reference}:${c.harness}` === e.target.value); if (choice) setChoice(choice);
      }}>
        {!configured && <option value="">{candidate ? "Not configured" : "—"}</option>}
        {reasoning.map(c => <option key={`${c.reasoning_configuration_reference}:${c.harness}`} value={`${c.reasoning_configuration_reference}:${c.harness}`}>{c.reasoning}</option>)}
      </select></td>
      <td><div className={styles.rowActions}>
        <ActionButton aria-label={`Save ${label}`} disabled={busy || locked || conflict || !dirty || !shownName.trim()} onClick={() => void send({ operation_id: crypto.randomUUID(), expected_revision: settings.revision,
          profile_id: profile.id, profile_version: shownVersion, name: shownName.trim(), description: shownDescription, candidates: shownCandidates })}>{pending && !pendingDelete ? "Saving…" : "Save"}</ActionButton>
        {profile.version === 0 ? <ActionButton disabled={busy || locked} aria-label={`Delete ${label}`} onClick={onRemove}>Delete</ActionButton> :
          <ActionButton ref={deleteButton} disabled={busy || locked} aria-label={`Delete ${label}`} onClick={() => setConfirmDelete(true)}>{pendingDelete ? "Deleting…" : "Delete"}</ActionButton>}
        {profile.version !== 0 && (dirty || error) && !unconfirmed && <ActionButton disabled={locked} aria-label={`Reset ${label}`} onClick={() => {
          setPending(true); void onReload().finally(() => { setDirty(false); setError(null); setConflict(false); setNotice(null); setPending(false); });
        }}>Reset</ActionButton>}
    {confirmDelete && <div className={styles.confirmDelete} role="group" aria-label={`Confirm delete ${label}`}>
      <span>Delete “{label}” for all providers?</span>
      <span>Affected work will return to the router.</span>
      <ActionButton ref={confirmButton} aria-label={`Confirm delete ${label}`} disabled={busy || locked} onClick={() => void send({ operation_id: crypto.randomUUID(), expected_revision: settings.revision,
        profile_id: profile.id, profile_version: shownVersion, name: profile.name ?? profile.id, description: profile.description ?? "", candidates: profile.candidates, delete: true })}>Confirm delete</ActionButton>
      <ActionButton disabled={busy || locked} onClick={() => { setConfirmDelete(false); deleteButton.current?.focus(); }}>Cancel</ActionButton>
    </div>}
        {notice && <span className={styles.success} role="status">{notice}</span>}
      </div></td>
    </tr>
    {error && <tr><td colSpan={5}><div role="alert" className={styles.warning}>{label}: {error}{conflict && " Your edits are preserved. Reset this row to load the latest settings."}</div>
      {unconfirmed && <div className={styles.rowActions}><ActionButton disabled={pending} onClick={() => void check()}>{unconfirmed.delete ? "Check delete status" : "Check save status"}</ActionButton>
        {retrySame && <ActionButton disabled={pending} onClick={() => void send(unconfirmed)}>{unconfirmed.delete ? "Retry same delete" : "Retry same save"}</ActionButton>}</div>}
    </td></tr>}
  </Fragment>;
}

export function IntelligenceSettings() {
  const { queryContext } = useSession(); const queryClient = useQueryClient(); const [params, setParams] = useSearchParams();
  const query = useQuery({ queryKey: queryKey(queryContext, "intelligence-settings", {}), queryFn: ({ signal }) => readIntelligence(signal), retry: false });
  const [added, setAdded] = useState<IntelligenceProfile[]>([]); const [busy, setBusy] = useState(false);
  const [deletedNotice, setDeletedNotice] = useState<string | null>(null); const addButton = useRef<HTMLButtonElement>(null);
  const focusAfterDelete = useRef(false);
  useEffect(() => { if (!busy && focusAfterDelete.current) { focusAfterDelete.current = false; addButton.current?.focus(); } }, [busy]);
  const provider = params.get("provider") ?? query.data?.model_choices[0]?.provider ?? "anthropic";
  const providers = Array.from(new Set([...Object.keys(PROVIDERS), ...(query.data?.model_choices.map(c => c.provider) ?? []),
    ...(query.data?.profiles.flatMap(p => p.candidates.map(c => c.provider).filter(p => p !== "configuration-required")) ?? []), provider]));
  const profiles = [...(query.data?.profiles ?? []), ...added.filter(p => !query.data?.profiles.some(existing => existing.id === p.id))];
  const choices = query.data?.model_choices.filter(c => c.provider === provider) ?? [];
  const sources = Array.from(new Set(choices.map(c => c.source).filter(Boolean)));
  const observed = choices.flatMap(c => c.observed_at ? [c.observed_at] : []).sort().at(-1);
  async function saved(result: IntelligenceSaved) {
    queryClient.setQueryData<IntelligenceSettings>(queryKey(queryContext, "intelligence-settings", {}), old => {
      if (!old) return old;
      const previous = old.profiles.find(p => p.id === result.profile.id);
      const profile = { ...result.profile, projects: previous?.projects ?? [] };
      return { ...old, revision: result.revision, active_digest: result.active_digest,
        profiles: result.disposition === "deleted" ? old.profiles.filter(p => p.id !== profile.id) : previous ? old.profiles.map(p => p.id === profile.id ? profile : p) : [...old.profiles, profile] };
    });
    await query.refetch(); setAdded(old => old.filter(p => p.id !== result.profile.id));
    if (result.disposition === "deleted") { focusAfterDelete.current = true; setDeletedNotice(`Deleted “${result.profile.name ?? result.profile.id}”.${result.routing ? " Affected work will use the router." : ""}`); }
    void queryClient.invalidateQueries({ predicate: q => q.queryKey.includes("project-execution-bindings") });
  }
  return <div className={styles.sheet}>
    <div className={styles.toolbar}>
      <label className={styles.provider}>Provider<select aria-label="Provider" value={provider} disabled={busy} onChange={e => setParams(old => { const next = new URLSearchParams(old); next.set("provider", e.target.value); return next; })}>
        {providers.map(id => <option key={id} value={id}>{PROVIDERS[id] ?? id}</option>)}
      </select></label>
      <div className={styles.rowActions}><ActionButton disabled={query.isFetching || busy} onClick={() => void query.refetch()}>Reload catalog</ActionButton>
      <ActionButton ref={addButton} disabled={!query.data || busy || profiles.length >= 128} onClick={() => setAdded(old => [...old, { id: `profile-${crypto.randomUUID()}`, version: 0, name: "", description: "", projects: [], candidates: [] }])}>Add row</ActionButton></div>
    </div>
    <p className={styles.meta}>Choose a model and effort for each profile. Other providers’ settings are preserved.</p>
    {query.data && choices.length === 0 && <p className={styles.meta}>No {PROVIDERS[provider] ?? provider} models are configured yet. You can add profile rows now; model choices become available after provider setup.</p>}
    {(sources.length > 0 || choices.some(c => c.preference_only)) && <details className={`${styles.meta} ${styles.catalog}`}>
      <summary>Model catalog{observed && <> · updated <time dateTime={observed}>{new Date(observed).toLocaleString()}</time></>}</summary>
      {choices.some(c => c.preference_only) && <p>Imported defaults are saved preferences. Worker and provider support are checked before launch.</p>}
      {sources.length > 0 && <p>Sources: {sources.join(", ")}</p>}
    </details>}
    {deletedNotice && <p role="status" className={styles.success}>{deletedNotice}</p>}
    <RetainedNotice query={query} />
    {!query.data ? <QueryStatus status={query.isError ? "error" : "pending"} error={query.error} label="intelligence profiles" onRetry={() => void query.refetch()} /> : <>
      <div className={styles.tableWrap} role="region" aria-label="Intelligence profiles spreadsheet, scroll horizontally" tabIndex={0}>
        <table className={styles.table} aria-label="Intelligence profiles">
          <thead><tr><th scope="col">Profile</th><th scope="col">Description</th><th scope="col">Model</th><th scope="col">Reasoning effort</th><th scope="col">Actions</th></tr></thead>
          <tbody>{profiles.map(profile => <ProfileRow key={profile.id} profile={profile} settings={query.data!} provider={provider} busy={busy} onBusy={setBusy} onSaved={saved}
            onRemove={() => { setAdded(old => old.filter(p => p.id !== profile.id)); addButton.current?.focus(); }} onReload={async () => { await query.refetch(); }} />)}</tbody>
        </table>
      </div>
      {profiles.length === 0 && <p className={styles.meta}>No profiles yet. Add a row to get started.</p>}
      <p className={styles.meta}>Save each row when ready. Changes apply to future launches.</p>
    </>}
  </div>;
}
