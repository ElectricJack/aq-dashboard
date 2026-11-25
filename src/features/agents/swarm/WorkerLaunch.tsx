import { useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { ActionButton } from "../../../components/layout/Workspace";
import type { NodeView } from "../../../api/adapters/swarm";
import { useManualAgents, capacity, launchProfileKey, selectionOf, type ManualFleet } from "./manualAgents";
import { workerProjects, launchOptions } from "./launchOptions";
import styles from "./WorkerInspector.module.css";

type Manual = NonNullable<ReturnType<typeof useManualAgents>>;
type Project = ManualFleet["projects"][number];

function useLaunchRequest() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  async function run(action: () => Promise<unknown>, fallback: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try { await action(); }
    catch (error) { setError(error instanceof Error ? error.message : fallback); }
    finally { lock.current = false; setBusy(false); }
  }
  return { error, busy, run };
}

function useLaunchSelection() {
  const [, setParams] = useSearchParams();
  const [selected, setSelected] = useState("");
  const [provider, setProvider] = useState("anthropic");
  const [profile, setProfile] = useState("");
  function updateSearch(key: string, value: string) {
    setParams(previous => {
      const next = new URLSearchParams(previous);
      next.set(key, value);
      return next;
    }, { replace: true });
  }
  function chooseProject(id: string) {
    setSelected(id);
    updateSearch("scope", `project:${id}`);
  }
  function chooseProvider(id: string) {
    setProvider(id);
    setProfile("");
  }
  const selectAgent = (id: string) => updateSearch("select", `agent:${id}`);
  return { selected, provider, profile, setProfile, chooseProject, chooseProvider, selectAgent };
}

function unavailableReason(manual: Manual, online: boolean) {
  if (!manual.fleet) return manual.error ? "Agent launch information could not be loaded." : "Loading agent launch information…";
  if (!online) return "Agent launch requires an online worker.";
  return "This worker has not reported agent support yet.";
}

function projectChoice(choices: Project[], scope: string | null, selection: string) {
  return choices.find(project => project.id === (scope ?? selection)) ?? (scope ? undefined : choices[0]);
}

type ProjectPicker = { choices: Project[]; chosen?: Project; busy: boolean; scoped: boolean; choose: (id: string) => void };
function ProjectField({ choices, chosen, busy, scoped, choose }: ProjectPicker) {
  return <label className={styles.field}>Project
    <select aria-label="Agent project" value={chosen?.id ?? ""} onChange={e => choose(e.target.value)} disabled={busy || scoped || !choices.length}>
      {!chosen && <option value="">None available</option>}
      {choices.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  </label>;
}

type Options = ReturnType<typeof launchOptions>;
function ProviderField({ options, busy, choose }: { options: Options; busy: boolean; choose: (provider: string) => void }) {
  return <label className={styles.field}>Provider
    <select aria-label="Agent provider" value={options.provider ?? ""} onChange={e => choose(e.target.value)} disabled={busy || !options.providers.length}>
      {!options.providers.length && <option value="">None reported</option>}
      {options.providers.map(p => <option key={p} value={p}>{p === "openai" ? "Codex" : "Claude"}</option>)}
    </select>
  </label>;
}

function LevelField({ options, busy, choose }: { options: Options; busy: boolean; choose: (profile: string) => void }) {
  const { profiles, choice } = options;
  const label = (p: Options["profiles"][number]) => `${p.name} · ${p.model} · ${p.reasoning}`;
  return <label className={styles.field}>Level
    <select aria-label="Agent level" title={choice && label(choice)} value={choice ? launchProfileKey(choice) : ""} onChange={e => choose(e.target.value)} disabled={busy || !profiles.length}>
      {!profiles.length && <option value="">None available</option>}
      {profiles.map(p => <option key={launchProfileKey(p)} value={launchProfileKey(p)}>{label(p)}</option>)}
    </select>
  </label>;
}

function ProjectSlots({ slots, limit, disabled, change }: { slots: number; limit: number; disabled: boolean; change: (delta: number) => void }) {
  return <div className={styles.projectSlots}>
    <div className={styles.actions} role="group" aria-label="Project worker slots">
      <strong>{slots} project slot{slots === 1 ? "" : "s"}</strong>
      <ActionButton aria-label="Remove project slot" onClick={() => change(-1)} disabled={disabled || slots === 0}>−</ActionButton>
      <ActionButton aria-label="Add project slot" onClick={() => change(1)} disabled={disabled || slots >= limit}>+</ActionButton>
    </div>
    <p className={styles.note}>Removing a busy slot lets its agent continue until stopped.</p>
  </div>;
}

function workerControls(manual: Manual, node: NodeView, selection: ReturnType<typeof useLaunchSelection>) {
  const fleet = manual.fleet;
  const worker = fleet?.workers.find(w => w.node_id === node.id);
  const choices = workerProjects(fleet, worker);
  const chosen = projectChoice(choices, manual.project, selection.selected);
  const options = launchOptions(fleet, worker, selection);
  const slots = chosen && fleet ? capacity(fleet, node.id, chosen.id) : 0;
  const available = !!worker && !!fleet && fleet.server_time_ms - worker.observed_at_ms < 15000 && node.health === "online";
  return { worker, choices, chosen, options, slots, available };
}

type Controls = ReturnType<typeof workerControls>;
type LaunchFormProps = {
  model: Controls; selection: ReturnType<typeof useLaunchSelection>; scoped: boolean; busy: boolean;
  launch: () => void; change: (delta: number) => void;
};
function LevelAndLaunch({ model, busy, choose, launch }: Pick<LaunchFormProps, "model" | "busy" | "launch"> & { choose: (id: string) => void }) {
  const { available, chosen, options } = model;
  const disabled = busy || !available || !chosen || !options.choice;
  return <>
    <LevelField options={options} busy={busy} choose={choose} />
    {!options.choice && available && <p className={styles.note}>No level lists a model for this provider. <Link to="/settings?tab=intelligence">Manage levels</Link></p>}
    <div className={styles.actions}><ActionButton className={styles.primary} onClick={launch} disabled={disabled}>{busy ? "Starting…" : "Launch agent"}</ActionButton></div>
  </>;
}

function LaunchForm({ model, selection, scoped, busy, launch, change }: LaunchFormProps) {
  const { available, chosen, choices, options, slots, worker } = model;
  if (!worker) return null;
  return <>
    <div className={styles.launchOptions}>
      <ProjectField choices={choices} chosen={chosen} busy={busy} scoped={scoped} choose={selection.chooseProject} />
      <ProviderField options={options} busy={busy} choose={selection.chooseProvider} />
    </div>
    {!chosen && <p className={styles.note}>No started project is available in this scope. <Link to="/settings?tab=projects">Manage projects</Link></p>}
    <LevelAndLaunch model={model} busy={busy} choose={selection.setProfile} launch={launch} />
    {chosen && <ProjectSlots slots={slots} limit={worker.max_slots} disabled={busy || !available} change={change} />}
  </>;
}

type WorkerActions = { node: NodeView; request: ReturnType<typeof useLaunchRequest>; selection: ReturnType<typeof useLaunchSelection> };
function launchActions(manual: Manual, model: Controls, { node, request, selection }: WorkerActions) {
  const { chosen, options: { choice } } = model;
  function launch() {
    if (!chosen || !choice) return;
    void request.run(() => {
      const id = crypto.randomUUID();
      selection.selectAgent(id);
      return manual.launch({ node: node.id, project: chosen.id, id, intelligence: selectionOf(choice) });
    }, "Launch could not be confirmed");
  }
  function change(delta: number) {
    if (chosen) void request.run(() => manual.setSlots(node.id, chosen.id, model.slots + delta), "Slot change could not be confirmed");
  }
  return { launch, change };
}

function LaunchNotice({ manual, online, canPushLogins }: { manual: Manual; online: boolean; canPushLogins: boolean }) {
  return <p role="status" className={styles.note}>{unavailableReason(manual, online)}
    {manual.fleet && online && canPushLogins && " Use the Logins tab to finish provider setup."}
  </p>;
}

export function WorkerLaunch({ node, canPushLogins }: { node: NodeView; canPushLogins: boolean }) {
  const manual = useManualAgents();
  const selection = useLaunchSelection();
  const request = useLaunchRequest();
  if (!manual) return null;
  const model = workerControls(manual, node, selection);
  const { launch, change } = launchActions(manual, model, { node, request, selection });
  const online = node.health === "online";
  return <section className={styles.launch} aria-label="Interactive agents">
    <h3>Interactive agents</h3>
    {!model.available && <LaunchNotice manual={manual} online={online} canPushLogins={canPushLogins} />}
    <LaunchForm model={model} selection={selection} scoped={!!manual.project} busy={request.busy} launch={launch} change={change} />
    {request.error && <p role="alert">{request.error}</p>}
  </section>;
}
