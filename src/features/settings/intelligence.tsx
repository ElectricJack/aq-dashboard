import { Fragment, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { ApiError } from "../../api/client";
import { inspectIntelligenceSave, readIntelligence, saveIntelligence, type Candidate, type IntelligenceProfile, type IntelligenceSettings, type ModelChoice, type SaveIntelligence, type IntelligenceSaved } from "../../api/intelligenceSettings";
import { inspectSwarmOperation, readSwarmSettings, useSwarmSettings, useUpdateSwarmLimits, type SwarmSettings, type UpdateSwarmLimits } from "../../api/swarmSettings";
import { queryKey } from "../../api/queryKeys";
import { useSession } from "../../app/session";
import { ActionButton } from "../../components/layout/Workspace";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { RetainedNotice } from "../../components/QueryStatus/RetainedNotice";
import { readIntelligenceStructure, type IntelligenceStructure, type IntelligenceStructureSaved } from "../../api/intelligenceSettings";
import { IntelligenceGroups, PARENT_NAMES, variationName, type ParentId, type ProfileAssignment } from "./IntelligenceGroups";
import { ParentDescriptionEditor, StructureDraftProvider, useStructureSave } from "./IntelligenceStructureControls";
import { RoutingPolicyEditor } from "./RoutingPolicyEditor";
import { IntelligenceDraftProvider, useIntelligenceDraft, useIntelligenceDrafts } from "./IntelligenceDrafts";
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
type RowOperation = { kind: "profile"; request: SaveIntelligence; cap?: UpdateSwarmLimits } | { kind: "cap"; request: UpdateSwarmLimits; profileSaved: boolean; refreshCatalog?: boolean };
type LimitDraft = { value: string; revision: string; catalogRevision: string };
export function ProfileRow({ profile, settings, provider, limits, busy, onBusy, onSaved, onRemove, onReload, variation, externallyLocked = false }: {
  profile: IntelligenceProfile; settings: IntelligenceSettings; provider: string; limits: SwarmSettings | undefined; busy: boolean;
  onBusy(value: boolean): void; onSaved(result: IntelligenceSaved): Promise<void>; onRemove(): void; onReload(): Promise<void>; variation?: string; externallyLocked?: boolean;
}) {
  const [name, setName] = useState(profile.name ?? profile.id);
  const [description, setDescription] = useState(profile.description ?? "");
  const [candidates, setCandidates] = useState(() => structuredClone(profile.candidates));
  const [version, setVersion] = useState(profile.version);
  const [dirty, setDirty] = useState(profile.version === 0);
  const baseline = useRef(profile);
  const [deleteQueued, setDeleteQueued] = useState(false);
  const drafts = useIntelligenceDrafts();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState<RowOperation | null>(null);
  const [partialProviders, setPartialProviders] = useState<Record<string, boolean>>({});
  const [limitDrafts, setLimitDrafts] = useState<Record<string, LimitDraft>>({});
  const capMutation = useUpdateSwarmLimits();
  const { queryContext } = useSession();
  const queryClient = useQueryClient();
  const [retrySame, setRetrySame] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (confirmDelete) { confirmButton.current?.focus(); confirmButton.current?.scrollIntoView?.({ block: "center", inline: "nearest" }); } }, [confirmDelete]);
  const rowLocked = pending || unconfirmed !== null || externallyLocked;
  const locked = rowLocked || drafts.saving || deleteQueued;
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
    if (!dirty) { baseline.current = structuredClone(profile); setName(shownName); setDescription(shownDescription); setCandidates(structuredClone(shownCandidates)); setVersion(shownVersion); }
    setDirty(true); setNotice(null);
  }
  function setChoice(choice: ModelChoice | null) {
    beginEdit();
    const otherProviders = shownCandidates.filter(c => c.provider !== provider && c.provider !== "configuration-required");
    if (choice) {
      const firstIndex = shownCandidates.findIndex(c => c.provider === provider);
      const insertionIndex = firstIndex < 0 ? otherProviders.length : shownCandidates.slice(0, firstIndex).filter(c => c.provider !== "configuration-required").length;
      otherProviders.splice(insertionIndex, 0, { id: candidate?.id ?? `choice-${crypto.randomUUID()}`, provider: choice.provider,
        model: choice.model, reasoning_configuration_reference: choice.reasoning_configuration_reference, harnesses: [choice.harness] });
    }
    setCandidates(otherProviders);
  }
  async function complete(result: IntelligenceSaved, continuing = false) {
    setName(result.profile.name ?? result.profile.id); setDescription(result.profile.description ?? "");
    setCandidates(structuredClone(result.profile.candidates)); setVersion(result.profile.version);
    await onSaved(result); setDirty(false); setUnconfirmed(null); setError(null); setConflict(false);
    setNotice(continuing ? null : result.disposition === "unchanged" ? "No changes to save." : "Saved.");
  }
  const cell = limits?.cells.find(c => c.provider === provider && c.intelligence_class === profile.id);
  const canSetLimit = !!limits && (!!cell || (dirty && !!configured));
  const currentLimit = cell?.effective_limit == null ? "" : String(cell.effective_limit);
  const limitDraft = limitDrafts[provider];
  const limitValue = limitDraft?.value ?? currentLimit;
  function completeCap(result: SwarmSettings, request: UpdateSwarmLimits) {
    queryClient.setQueryData<SwarmSettings>(queryKey(queryContext, "swarm-settings", {}), old => !old || BigInt(result.revision) >= BigInt(old.revision) ? result : old);
    void queryClient.invalidateQueries({ queryKey: queryKey(queryContext, "swarm-settings", {}) });
    drafts.confirmRevision("swarm-limits", request.expected_revision, result.revision);
    const savedProvider = request.cell!.provider;
    setLimitDrafts(old => { const next = { ...old }; delete next[savedProvider]; return next; });
    setPartialProviders(old => { const next = { ...old }; delete next[savedProvider]; return next; });
    setUnconfirmed(null); setError(null); setConflict(false); setNotice("Saved.");
  }
  async function run(operation: RowOperation, inspect = false) {
    if (pending) return false;
    let phase = operation;
    let uncertain = false;
    setPending(true); setPendingDelete(phase.kind === "profile" && phase.request.delete === true); setConfirmDelete(false); onBusy(true); setError(null); setNotice(null); setConflict(false);
    try {
      if (phase.kind === "profile") {
        const receipt = await (inspect ? inspectIntelligenceSave(phase.request.operation_id) : saveIntelligence(phase.request));
        drafts.confirmRevision("intelligence", phase.request.expected_revision, receipt.revision);
        await complete(receipt, !!phase.cap);
        if (!phase.cap) return true;
        const cap = phase.cap;
        setPartialProviders(old => ({ ...old, [cap.cell!.provider]: true }));
        phase = { kind: "cap", request: cap, profileSaved: true, refreshCatalog: true };
        inspect = false;
      }
      if (phase.refreshCatalog) {
        // Profile edits may change the catalog. Preserve the original limits
        // revision so concurrent limits edits still conflict.
        let catalog: SwarmSettings;
        try { catalog = await readSwarmSettings(); }
        catch { setNotice(null); setError("Profile saved. Max agents were not saved because the limits catalog is unavailable. Your limit entry is preserved; retry Save."); return false; }
        phase = { ...phase, request: { ...phase.request, expected_catalog_revision: catalog.catalog_revision }, refreshCatalog: false };
      }
      completeCap(await (inspect ? inspectSwarmOperation(phase.request.operation_id) : capMutation.mutateAsync(phase.request)), phase.request);
      return true;
    } catch (e) {
      const prefix = phase.kind === "cap" && phase.profileSaved ? "Profile saved. " : "";
      setNotice(null);
      if (inspect) {
        setUnconfirmed(phase); uncertain = true;
        setRetrySame(e instanceof ApiError && e.status === 404);
        setError(prefix + (e instanceof ApiError && e.status === 404 ? "Save not recorded yet. Retry the same save safely." : "Save status is unavailable. This row is preserved."));
      } else if (e instanceof ApiError && e.status !== undefined && e.status >= 400 && e.status < 500) {
        setError(prefix + (phase.kind === "cap" ? "Max agents were not saved. " : "") + errorMessage(e));
        setConflict(phase.kind === "profile" && e.status === 409 && !phase.request.delete); setUnconfirmed(null);
      } else {
        setUnconfirmed(phase); uncertain = true; setRetrySame(false);
        setError(prefix + `${phase.kind === "profile" && phase.request.delete ? "Delete" : phase.kind === "cap" ? "Max agents save" : "Save"} unconfirmed. Check its status before editing this row again.`);
      }
      return false;
    } finally { setPending(false); setPendingDelete(false); onBusy(uncertain); }
  }
  const profileDirty = profile.version === 0 || (dirty && (shownName !== (baseline.current.name ?? baseline.current.id) || shownDescription !== (baseline.current.description ?? "") || JSON.stringify(shownCandidates) !== JSON.stringify(baseline.current.candidates)));
  const capEntries = Object.entries(limitDrafts).filter(([draftProvider, draft]) => {
    const effective = limits?.cells.find(item => item.provider === draftProvider && item.intelligence_class === profile.id)?.effective_limit;
    return draft.value !== (effective == null ? "" : String(effective));
  });
  async function saveRow() {
    if (rowLocked || conflict) return false;
    const latest = queryClient.getQueryData<IntelligenceSettings>(queryKey(queryContext, "intelligence-settings", {})) ?? settings;
    if (deleteQueued) return run({ kind: "profile", request: { operation_id: crypto.randomUUID(), expected_revision: latest.revision,
      profile_id: profile.id, profile_version: shownVersion, name: profile.name ?? profile.id, description: profile.description ?? "", candidates: profile.candidates, delete: true } });
    if (!shownName.trim() || capEntries.some(([, draft]) => draft.value !== "" && (!/^\d+$/.test(draft.value) || !Number.isSafeInteger(Number(draft.value)) || Number(draft.value) > 4294967295))) {
      setError("Enter a profile name and valid max agents values before saving."); return false;
    }
    let profileWasSaved = !!Object.keys(partialProviders).length;
    if (profileDirty) {
      if (!await run({ kind: "profile", request: { operation_id: crypto.randomUUID(), expected_revision: latest.revision,
        profile_id: profile.id, profile_version: shownVersion, name: shownName.trim(), description: shownDescription, candidates: shownCandidates } })) return false;
      profileWasSaved = true;
    }
    for (const [draftProvider, draft] of capEntries) {
      if (profileWasSaved) setPartialProviders(old => ({ ...old, [draftProvider]: true }));
      if (!await run({ kind: "cap", profileSaved: profileWasSaved, refreshCatalog: profileWasSaved || drafts.hasConfirmedChanges("intelligence"), request: { operation_id: crypto.randomUUID(),
        expected_revision: drafts.resolveRevision("swarm-limits", draft.revision), expected_catalog_revision: draft.catalogRevision,
        cell: { provider: draftProvider, intelligence_class: profile.id, limit: draft.value === "" ? null : Number(draft.value) } } })) return false;
    }
    return true;
  }
  useIntelligenceDraft({ id: `profile:${profile.id}`, label: shownName.trim() || "new profile", dirty: profileDirty || capEntries.length > 0 || deleteQueued || unconfirmed !== null,
    locked: rowLocked || conflict, save: saveRow, order: 10 });
  const label = shownName.trim() || "new profile";
  return <Fragment>
    <tr aria-label={label} data-profile-id={profile.id}>
      <td>{variation ? <details className={styles.identities}><summary><strong>{variation}</strong></summary><span>{profile.id}</span>{profile.projects.length > 0 && <span>{profile.projects.length} project {profile.projects.length === 1 ? "reference" : "references"}</span>}</details> : <input aria-label="Profile name" value={shownName} required maxLength={128} disabled={locked} onChange={e => { beginEdit(); setName(e.target.value); }} />}</td>
      {!variation && <td><input aria-label="Description" value={shownDescription} maxLength={2000} disabled={locked} onChange={e => { beginEdit(); setDescription(e.target.value); }} /></td>}
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
      <td><div className={styles.limitCell}><input type="number" min="0" max="4294967295" step="1" aria-label={`Max agents for ${profile.name ?? profile.id}`} placeholder="Unlimited" value={limitValue}
        disabled={busy || locked || !canSetLimit} onChange={e => { if (limits) setLimitDrafts(old => ({ ...old, [provider]: { value: e.target.value, revision: old[provider]?.revision ?? limits.revision, catalogRevision: old[provider]?.catalogRevision ?? limits.catalog_revision } })); setNotice(null); setError(null); }} />
        {!canSetLimit && <span className={styles.meta}>{profile.version === 0 ? "Save profile first" : "Unavailable"}</span>}
      </div></td>
      <td><div className={styles.rowActions}>
        {deleteQueued ? <><span className={styles.meta}>Marked for deletion</span><ActionButton disabled={rowLocked || drafts.saving} onClick={() => setDeleteQueued(false)}>Undo delete</ActionButton></> : profile.version === 0 ? <ActionButton disabled={busy || locked} aria-label={`Delete ${label}`} onClick={onRemove}>Delete</ActionButton> :
          <ActionButton ref={deleteButton} disabled={busy || locked} aria-label={`Delete ${label}`} onClick={() => setConfirmDelete(true)}>{pendingDelete ? "Deleting…" : "Delete"}</ActionButton>}
        {profile.version !== 0 && (conflict || error) && !unconfirmed && <ActionButton disabled={locked} aria-label={`Reset ${label}`} onClick={() => {
          setPending(true); void onReload().finally(() => { setDirty(false); setLimitDrafts({}); setPartialProviders({}); setError(null); setConflict(false); setNotice(null); setPending(false); });
        }}>Discard row changes</ActionButton>}
    {confirmDelete && <div className={styles.confirmDelete} role="group" aria-label={`Confirm delete ${label}`}>
      <span>Delete “{label}” for all providers?</span>
      <span>Affected work will return to the router.</span>
      <ActionButton ref={confirmButton} aria-label={`Confirm delete ${label}`} disabled={busy || locked} onClick={() => { setDeleteQueued(true); setConfirmDelete(false); setNotice(null); }}>Confirm delete</ActionButton>
      <ActionButton disabled={busy || locked} onClick={() => { setConfirmDelete(false); deleteButton.current?.focus(); }}>Cancel</ActionButton>
    </div>}
        {notice && <span className={styles.success} role="status">{notice}</span>}
      </div></td>
    </tr>
    {error && <tr><td colSpan={variation ? 5 : 6}><div role="alert" className={styles.warning}>{label}: {error}{conflict && " Your edits are preserved. Discard this row’s changes to load the latest settings."}</div>
      {unconfirmed && <div className={styles.rowActions}><ActionButton disabled={pending} onClick={() => void run(unconfirmed, true)}>{unconfirmed.kind === "profile" && unconfirmed.request.delete ? "Check delete status" : "Check save status"}</ActionButton>
        {retrySame && <ActionButton disabled={pending} onClick={() => void run(unconfirmed)}>{unconfirmed.kind === "profile" && unconfirmed.request.delete ? "Retry delete operation" : "Retry operation"}</ActionButton>}</div>}
    </td></tr>}
  </Fragment>;
}

type PendingVariation = { parent: ParentId; effort: ProfileAssignment["effort"]; structure: IntelligenceStructure };
function NewVariationRow({ variation, onStructureSaved, onCancel, ...props }: Parameters<typeof ProfileRow>[0] & {
  variation: string; pendingVariation: PendingVariation; onStructureSaved(result: IntelligenceStructureSaved, profileId: string): Promise<void>; onCancel(): void;
}) {
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const operation = useStructureSave(result => onStructureSaved(result, props.profile.id), props.onBusy);
  const pending = props.pendingVariation;
  async function saveAssignment() {
    if (operation.locked || preparing) return false;
    setPreparing(true); setAttempted(true); setAssignmentError(null);
    try {
      const [latest, catalog] = await Promise.all([readIntelligenceStructure(), readIntelligence()]);
      if (!catalog.profiles.some(item => item.id === props.profile.id)) { setAssignmentError("Save this profile before assigning its variation."); return false; }
      const slot = latest.assignments.find(item => item.parent_id === pending.parent && item.effort === pending.effort);
      const assignedElsewhere = latest.assignments.find(item => item.profile_id === props.profile.id && (item.parent_id !== pending.parent || item.effort !== pending.effort));
      if (assignedElsewhere || (slot && slot.profile_id !== props.profile.id && catalog.profiles.some(item => item.id === slot.profile_id))) {
        setAssignmentError("This variation changed elsewhere. The saved profile is preserved; keep it in Other profiles to continue."); return false;
      }
      operation.reset();
      return await operation.run({ operation_id: crypto.randomUUID(), expected_revision: latest.revision, expected_catalog_revision: catalog.revision,
        parents: latest.parents, routing_markdown: latest.routing_markdown,
        assignments: [...latest.assignments.filter(item => item.profile_id !== props.profile.id && (item.parent_id !== pending.parent || item.effort !== pending.effort)), { profile_id: props.profile.id, parent_id: pending.parent, effort: pending.effort }] });
    } catch { setAssignmentError("Could not load assignment settings. The saved profile is preserved."); return false; }
    finally { setPreparing(false); }
  }
  const drafts = useIntelligenceDraft({ id: `assignment:${props.profile.id}`, label: `${props.profile.name ?? props.profile.id} variation assignment`, dirty: true,
    locked: operation.locked || preparing, save: saveAssignment, order: 50 });
  return <>
    <ProfileRow {...props} variation={variation} externallyLocked={operation.locked || attempted || preparing} onSaved={async result => {
      await props.onSaved(result); if (result.disposition === "deleted") onCancel();
    }} />
    {attempted && <tr><td colSpan={5}>{operation.feedback}
      {assignmentError && <p className={styles.warning} role="alert">{assignmentError}</p>}
      {!operation.locked && <ActionButton disabled={preparing || drafts.saving} onClick={onCancel}>Keep in Other profiles</ActionButton>}
    </td></tr>}
  </>;
}

export function IntelligenceSettings() { return <IntelligenceDraftProvider><StructureDraftProvider><IntelligenceSettingsContent /></StructureDraftProvider></IntelligenceDraftProvider>; }

function IntelligenceSettingsContent() {
  const drafts = useIntelligenceDrafts();
  const { queryContext } = useSession(); const queryClient = useQueryClient(); const [params, setParams] = useSearchParams();
  const query = useQuery({ queryKey: queryKey(queryContext, "intelligence-settings", {}), queryFn: ({ signal }) => readIntelligence(signal), retry: false });
  const limits = useSwarmSettings();
  const structure = useQuery({ queryKey: queryKey(queryContext, "intelligence-structure", {}), queryFn: ({ signal }) => readIntelligenceStructure(signal), retry: false });
  const [pendingVariations, setPendingVariations] = useState<Record<string, PendingVariation>>({});
  const [added, setAdded] = useState<IntelligenceProfile[]>([]); const [busy, setBusy] = useState(false);
  const [deletedNotice, setDeletedNotice] = useState<string | null>(null); const addButton = useRef<HTMLButtonElement>(null);
  const focusAfterDelete = useRef(false);
  useEffect(() => { if (!busy && focusAfterDelete.current) { focusAfterDelete.current = false; addButton.current?.focus(); } }, [busy]);
  const provider = params.get("provider") ?? query.data?.model_choices[0]?.provider ?? "anthropic";
  const providers = Array.from(new Set([...Object.keys(PROVIDERS), ...(query.data?.model_choices.map(c => c.provider) ?? []),
    ...(query.data?.profiles.flatMap(p => p.candidates.map(c => c.provider).filter(p => p !== "configuration-required")) ?? []), provider]));
  const profiles = [...(query.data?.profiles ?? []), ...added.filter(p => !query.data?.profiles.some(existing => existing.id === p.id))];
  const localAssignments = Object.entries(pendingVariations).map(([id, item]) => ({ profile_id: id, parent_id: item.parent, effort: item.effort }));
  const assignments = [...(structure.data?.assignments ?? []).filter(item => !localAssignments.some(local => local.profile_id === item.profile_id || (local.parent_id === item.parent_id && local.effort === item.effort))), ...localAssignments];
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
    void queryClient.invalidateQueries({ queryKey: queryKey(queryContext, "swarm-settings", {}) });
    await query.refetch(); setAdded(old => old.filter(p => p.id !== result.profile.id));
    if (result.disposition === "deleted") { focusAfterDelete.current = true; setDeletedNotice(`Deleted “${result.profile.name ?? result.profile.id}”.${result.routing ? " Affected work will use the router." : ""}`); }
    void queryClient.invalidateQueries({ predicate: q => q.queryKey.includes("project-execution-bindings") });
  }
  async function structureSaved(result: IntelligenceStructureSaved, profileId?: string) {
    queryClient.setQueryData<IntelligenceStructure>(queryKey(queryContext, "intelligence-structure", {}), old => !old || BigInt(result.revision) >= BigInt(old.revision) ? result : old);
    if (profileId) setPendingVariations(old => { const next = { ...old }; delete next[profileId]; return next; });
    await structure.refetch();
  }
  const reload = async () => { await Promise.all([query.refetch(), limits.refetch(), structure.refetch()]); };
  function row(profile: IntelligenceProfile, variation?: string) {
    const props = { profile, settings: query.data!, provider, limits: limits.isError ? undefined : limits.data, busy, onBusy: setBusy, onSaved: saved,
      onRemove: () => { setAdded(old => old.filter(p => p.id !== profile.id)); setPendingVariations(old => { const next = { ...old }; delete next[profile.id]; return next; }); addButton.current?.focus(); }, onReload: reload, variation };
    const pending = pendingVariations[profile.id];
    return pending ? <NewVariationRow key={profile.id} {...props} variation={variation!} pendingVariation={pending} onStructureSaved={structureSaved} onCancel={() => setPendingVariations(old => { const next = { ...old }; delete next[profile.id]; return next; })} /> : <ProfileRow key={profile.id} {...props} />;
  }
  function table(rows: IntelligenceProfile[]) { return <div className={styles.tableWrap} role="region" aria-label="Intelligence profiles spreadsheet, scroll horizontally" tabIndex={0}>
    <table className={styles.table} aria-label="Intelligence profiles"><thead><tr><th scope="col">Profile</th><th scope="col">Description</th><th scope="col">Model</th><th scope="col">Reasoning effort</th><th scope="col">Max agents</th><th scope="col">Actions</th></tr></thead><tbody>{rows.map(profile => row(profile))}</tbody></table>
  </div>; }
  return <div className={styles.sheet}>
    <div className={styles.toolbar}>
      <label className={styles.provider}>Provider<select aria-label="Provider" value={provider} disabled={busy || drafts.saving} onChange={e => setParams(old => { const next = new URLSearchParams(old); next.set("provider", e.target.value); return next; })}>
        {providers.map(id => <option key={id} value={id}>{PROVIDERS[id] ?? id}</option>)}
      </select></label>
      <div className={styles.rowActions}><ActionButton disabled={!drafts.dirty || drafts.saving || drafts.locked || busy} onClick={() => void drafts.saveAll()}>{drafts.saving ? "Saving…" : "Save"}</ActionButton><ActionButton disabled={query.isFetching || busy || drafts.saving} onClick={() => void query.refetch()}>Reload catalog</ActionButton>
      <ActionButton ref={addButton} disabled={!query.data || structure.isPending || busy || drafts.saving || profiles.length >= 128} onClick={() => setAdded(old => [...old, { id: `profile-${crypto.randomUUID()}`, version: 0, name: "", description: "", projects: [], candidates: [] }])}>Add row</ActionButton></div>
    </div>
    {drafts.message && (drafts.message !== "Saved." || !drafts.dirty) && <p role="status" aria-label="Intelligence save status" className={styles.meta}>{drafts.message}</p>}
    <p className={styles.meta}>Choose a model and effort for each variation. Other providers’ settings are preserved.</p>
    {query.data && choices.length === 0 && <p className={styles.meta}>No {PROVIDERS[provider] ?? provider} models are configured yet. You can add profile rows now; model choices become available after provider setup.</p>}
    {(sources.length > 0 || choices.some(c => c.preference_only)) && <details className={`${styles.meta} ${styles.catalog}`}>
      <summary>Model catalog{observed && <> · updated <time dateTime={observed}>{new Date(observed).toLocaleString()}</time></>}</summary>
      {choices.some(c => c.preference_only) && <p>Imported defaults are saved preferences. Worker and provider support are checked before launch.</p>}
      {sources.length > 0 && <p>Sources: {sources.join(", ")}</p>}
    </details>}
    {deletedNotice && <p role="status" className={styles.success}>{deletedNotice}</p>}
    <RetainedNotice query={query} />
    {limits.isError && <p role="alert" className={styles.warning}>Agent limits are unavailable. Profile editing is still available. <ActionButton onClick={() => void limits.refetch()}>Reload limits</ActionButton></p>}
    {!query.data ? <QueryStatus status={query.isError ? "error" : "pending"} error={query.error} label="intelligence profiles" onRetry={() => void query.refetch()} /> : <>
      {structure.data ? <IntelligenceGroups profiles={profiles} assignments={assignments} renderRow={row} otherTable={table}
        renderParent={parent => <ParentDescriptionEditor parent={parent} structure={structure.data!} catalogRevision={query.data!.revision} busy={busy} onBusy={setBusy} onSaved={structureSaved} onReload={async () => { const result = await structure.refetch(); if (!result.isSuccess) throw result.error; }} />}
        renderMissing={(parent, effort) => <div className={styles.rowActions}><ActionButton disabled={busy || drafts.saving || profiles.length >= 128} aria-label={`Add variation: ${PARENT_NAMES[parent]} ${variationName(effort)}`} onClick={() => {
          const id = `profile-${crypto.randomUUID()}`;
          setAdded(old => [...old, { id, version: 0, name: `${PARENT_NAMES[parent]} ${variationName(effort)}`, description: "", candidates: [], projects: [] }]);
          setPendingVariations(old => ({ ...old, [id]: { parent, effort, structure: structuredClone(structure.data!) } }));
        }}>Add variation</ActionButton></div>} /> : structure.isPending ? <QueryStatus status="pending" error={null} label="intelligence types" onRetry={() => void structure.refetch()} /> : table(profiles)}
      {structure.isError && <p className={styles.warning}>Intelligence types are unavailable. Existing profiles remain editable. <ActionButton onClick={() => void structure.refetch()}>Reload types</ActionButton></p>}
      {structure.data && <RoutingPolicyEditor />}
      {profiles.length === 0 && <p className={styles.meta}>No profiles yet. Add a row to get started.</p>}
      <p className={styles.meta}>Blank max agents means unlimited; 0 pauses new launches. Running agents finish.</p>
    </>}
  </div>;
}
