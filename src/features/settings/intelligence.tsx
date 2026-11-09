import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { ApiError } from "../../api/client";
import { inspectIntelligenceSave, readIntelligence, saveIntelligence, type Candidate, type IntelligenceProfile, type IntelligenceSettings, type ModelChoice, type SaveIntelligence, type IntelligenceSaved } from "../../api/intelligenceSettings";
import { queryKey } from "../../api/queryKeys";
import { PageTitle } from "../../app/DestinationPage";
import { useSession } from "../../app/session";
import { useDocumentTitle } from "../../app/documentTitle";
import { ActionButton, Panel } from "../../components/layout/Workspace";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { RetainedNotice } from "../../components/QueryStatus/RetainedNotice";
import styles from "./Intelligence.module.css";

const profileKey = (p: IntelligenceProfile) => `${p.id}@${p.version}`;
const modelKey = (p: Pick<ModelChoice, "provider" | "model">) => `${p.provider}:${p.model}`;
function choiceFor(candidate: Candidate, choices: ModelChoice[]) {
  return choices.find(c => c.provider === candidate.provider && c.model === candidate.model
    && c.reasoning_configuration_reference === candidate.reasoning_configuration_reference && candidate.harnesses.includes(c.harness));
}
function pick(candidate: Candidate, choice: ModelChoice): Candidate {
  return { ...candidate, provider: choice.provider, model: choice.model,
    reasoning_configuration_reference: choice.reasoning_configuration_reference, harnesses: [choice.harness] };
}
function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.serverMessage ?? "The save could not be confirmed." : "The save could not be confirmed.";
}

function Editor({ profile, settings, onSaved, onCancel }: {
  profile: IntelligenceProfile; settings: IntelligenceSettings; onSaved(result: IntelligenceSaved): void; onCancel(): void;
}) {
  // The mounted form owns its snapshot. Background reads never replace a draft.
  const [name, setName] = useState(profile.name ?? profile.id);
  const [description, setDescription] = useState(profile.description ?? "");
  const [candidates, setCandidates] = useState(() => structuredClone(profile.candidates));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState<SaveIntelligence | null>(null);
  const [retrySame, setRetrySame] = useState(false);
  const [conflict, setConflict] = useState(false);
  const locked = pending || unconfirmed !== null;
  const models = settings.model_choices.filter((choice, i, all) => all.findIndex(c => modelKey(c) === modelKey(choice)) === i);
  const change = (index: number, value: Candidate) => setCandidates(old => old.map((candidate, i) => i === index ? value : candidate));
  async function send(request: SaveIntelligence) {
    if (pending) return;
    setPending(true); setError(null); setConflict(false);
    try { onSaved(await saveIntelligence(request)); }
    catch (e) {
      if (e instanceof ApiError && e.status !== undefined && e.status >= 400 && e.status < 500) {
        setError(errorMessage(e)); setConflict(e.status === 409); setUnconfirmed(null);
      } else {
        setUnconfirmed(request); setRetrySame(false);
        setError("The connection was interrupted, so this save is unconfirmed. Check its status before editing again.");
      }
    } finally { setPending(false); }
  }
  async function check() {
    if (!unconfirmed || pending) return;
    setPending(true);
    try { onSaved(await inspectIntelligenceSave(unconfirmed.operation_id)); }
    catch (e) {
      setRetrySame(e instanceof ApiError && e.status === 404);
      setError(e instanceof ApiError && e.status === 404 ? "This save has not been recorded yet. You can retry the same save safely." : "Save status is unavailable. Your draft is preserved.");
    } finally { setPending(false); }
  }
  return <Panel title={`Edit ${profile.name ?? profile.id}`}>
    <form onSubmit={event => {
      event.preventDefault();
      if (locked || conflict || !name.trim()) return;
      void send({ operation_id: crypto.randomUUID(), expected_revision: settings.revision, profile_id: profile.id,
        profile_version: profile.version, name: name.trim(), description, candidates });
    }}>
      <p className={styles.meta}>Changes apply to future agent launches. Running sessions keep their current settings.</p>
      <fieldset disabled={locked} className={styles.fields}>
        <label>Name<input value={name} maxLength={128} required onChange={event => setName(event.target.value)} /></label>
        <label>Description<textarea value={description} maxLength={2000} rows={3} onChange={event => setDescription(event.target.value)} /></label>
        <h3 className={styles.heading}>Model choices</h3>
        <p className={styles.meta}>Choose from models and reasoning settings configured on this system. Choices are tried in order.</p>
        {candidates.map((candidate, index) => {
          const configured = choiceFor(candidate, settings.model_choices);
          const reasoning = settings.model_choices.filter(c => modelKey(c) === modelKey(candidate));
          return <fieldset key={candidate.id} className={styles.candidate}>
            <legend>Choice {index + 1}</legend>
            {!configured && <p className={styles.warning}>This choice needs launch configuration before it can run.</p>}
            <label>Provider and model<select value={modelKey(candidate)} onChange={event => {
              const choice = models.find(c => modelKey(c) === event.target.value); if (choice) change(index, pick(candidate, choice));
            }}>
              {!models.some(c => modelKey(c) === modelKey(candidate)) && <option value={modelKey(candidate)}>{candidate.provider} · {candidate.model} (not configured)</option>}
              {models.map(choice => <option key={modelKey(choice)} value={modelKey(choice)}>{choice.provider} · {choice.model}</option>)}
            </select></label>
            <label>Reasoning<select value={configured ? `${configured.reasoning_configuration_reference}:${configured.harness}` : "unconfigured"} onChange={event => {
              const choice = reasoning.find(c => `${c.reasoning_configuration_reference}:${c.harness}` === event.target.value); if (choice) change(index, pick(candidate, choice));
            }}>
              {!configured && <option value="unconfigured">Not configured</option>}
              {reasoning.map(choice => <option key={`${choice.reasoning_configuration_reference}:${choice.harness}`} value={`${choice.reasoning_configuration_reference}:${choice.harness}`}>{choice.reasoning}</option>)}
            </select></label>
            {candidates.length > 1 && <ActionButton onClick={() => setCandidates(old => old.filter((_, i) => i !== index))}>Remove choice {index + 1}</ActionButton>}
          </fieldset>;
        })}
        <ActionButton disabled={settings.model_choices.length === 0 || candidates.length >= 16} onClick={() => {
          const choice = settings.model_choices[0];
          if (choice) setCandidates(old => [...old, pick({ id: `choice-${crypto.randomUUID()}`, provider: "", model: "", reasoning_configuration_reference: "", harnesses: [] }, choice)]);
        }}>Add model choice</ActionButton>
      </fieldset>
      <p className={styles.meta}>Used by {profile.projects.length} {profile.projects.length === 1 ? "project" : "projects"}{profile.projects.length > 0 && `: ${profile.projects.map(p => p.name).join(", ")}`}. Their saved profile references update together.</p>
      {error && <div role="alert" className={styles.warning}><p>{error}</p>{conflict && <p>Your draft is preserved. Cancel and reopen the editor to load the current settings.</p>}</div>}
      {unconfirmed && <div className={styles.actions}>
        <ActionButton disabled={pending} onClick={() => void check()}>Check save status</ActionButton>
        {retrySame && <ActionButton disabled={pending} onClick={() => void send(unconfirmed)}>Retry same save</ActionButton>}
      </div>}
      <div className={styles.actions}>
        <ActionButton disabled={locked} onClick={onCancel}>Cancel</ActionButton>
        <ActionButton type="submit" disabled={locked || conflict || !name.trim()}>{pending ? "Saving…" : "Save changes"}</ActionButton>
      </div>
    </form>
  </Panel>;
}

export function Component() {
  useDocumentTitle("Intelligence profiles");
  const { queryContext } = useSession();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: queryKey(queryContext, "intelligence-settings", {}), queryFn: ({ signal }) => readIntelligence(signal), retry: false });
  const [editing, setEditing] = useState<{ profile: IntelligenceProfile; settings: IntelligenceSettings } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  function saved(result: IntelligenceSaved) {
    setEditing(null);
    setNotice(result.disposition === "unchanged" ? "No changes to save." : "Profile saved. Future agent launches will use the updated settings.");
    void queryClient.invalidateQueries({ predicate: q => q.queryKey.includes("intelligence-settings") || q.queryKey.includes("project-execution-bindings") });
  }
  const profiles = query.data?.profiles.slice().sort((a, b) => Number(b.candidates.some(c => choiceFor(c, query.data!.model_choices))) - Number(a.candidates.some(c => choiceFor(c, query.data!.model_choices))));
  return <div className={styles.page}>
    <Link to="/settings">← Settings</Link>
    <PageTitle>Intelligence profiles</PageTitle>
    <p className={styles.meta}>Choose the models and reasoning settings your agents use.</p>
    {notice && <p role="status" className={styles.success}>{notice}</p>}
    <RetainedNotice query={query} />
    {!query.data ? <QueryStatus status={query.isError ? "error" : "pending"} error={query.error} label="intelligence profiles" onRetry={() => void query.refetch()} /> : (
      <div className={styles.columns}>
        <Panel title="Profiles">
          {profiles?.length === 0 ? <p>No intelligence profiles are configured.</p> : <ul className={styles.profiles} aria-label="Intelligence profiles">
            {profiles?.map(profile => <li key={profileKey(profile)}>
              <strong>{profile.name ?? profile.id}</strong>
              {profile.description && <p className={styles.meta}>{profile.description}</p>}
              <p className={styles.meta}>{profile.candidates.map(c => `${c.provider} · ${c.model}`).join(", ")}</p>
              <ActionButton disabled={editing !== null} onClick={() => { setNotice(null); setEditing({ profile: structuredClone(profile), settings: structuredClone(query.data!) }); }}>Edit {profile.name ?? profile.id}</ActionButton>
            </li>)}
          </ul>}
        </Panel>
        {editing ? <Editor key={profileKey(editing.profile)} profile={editing.profile} settings={editing.settings} onSaved={saved} onCancel={() => { setEditing(null); void query.refetch(); }} />
          : <Panel title="Edit a profile"><p className={styles.meta}>Select a profile to view and edit its model choices. Changes apply to every project using that profile.</p></Panel>}
      </div>
    )}
  </div>;
}
