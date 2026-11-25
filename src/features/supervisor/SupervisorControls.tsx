import {useEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Link} from 'react-router';
import {useSession} from '../../app/session';
import {useDraft} from '../../app/useDraft';
import {ApiError} from '../../api/client';
import {isRecord} from '../../api/adapters/contract';
import {supervisorId} from '../../api/adapters/supervisor';
import {readSupervisors,setSupervisor,inspectSupervisorControl,type SupervisorControl,type SupervisorIntent,type SupervisorFleet} from '../../api/supervisors';
import {launchProfileKey as key,selectionOf} from '../agents/swarm/manualAgents';
import {ActionButton} from '../../components/layout/Workspace';
import styles from './SupervisorConversation.module.css';
export function validSupervisorScope(scope: unknown): scope is string {
  if (scope === "global") return true;
  if (typeof scope !== "string" || !scope.startsWith("project:")) return false;
  return supervisorId(scope.slice(8));
}

export function useSupervisors(enabled: boolean) {
  const { bootstrap, queryContext } = useSession();
  return useQuery({
    queryKey: ["supervisor-controls", queryContext.principalId, queryContext.authorizationRevision],
    enabled: enabled && bootstrap.capability("supervisor.history.read").enabled,
    queryFn: ({ signal }) => readSupervisors(signal),
    refetchInterval: enabled ? 2000 : false,
    retry: false,
  });
}

function validIntent(value: unknown): value is SupervisorIntent | null {
  if (value === null) return true;
  if (!isRecord(value) || !supervisorId(value.operation_id)) return false;
  if (!Number.isSafeInteger(value.expected_revision) || typeof value.enabled !== "boolean") return false;
  return value.intelligence_profile === undefined || isRecord(value.intelligence_profile);
}

/** A stored choice missing from the catalog leaves an enabled supervisor waiting for the owner. */
const waiting = (supervisor: SupervisorControl | undefined) => !!supervisor?.enabled && !!supervisor.unavailable_reason;
const WAITING = "Waiting for a level";
const labels = { idle: "Ready", working: "Working", waiting: "Waiting", stopped: "Stopped", stopping: "Stopping", failed: "Needs attention", uncertain: "Needs inspection", unavailable: "Offline" };
function phaseLabel(selected?: SupervisorControl) {
  if (!selected) return "Unavailable";
  return waiting(selected) ? WAITING : labels[selected.phase];
}

function useMobileControls(scope: string, selected?: SupervisorControl) {
  const [mobile, setMobile] = useState(() => window.innerWidth < 768);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const resize = () => setMobile(window.innerWidth < 768);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const needsLevel = waiting(selected);
  useEffect(() => { setExpanded(!selected?.enabled || needsLevel); }, [scope, selected?.enabled, needsLevel]);
  return { open: !mobile || expanded, toggle(open: boolean) { if (mobile) setExpanded(open); } };
}

type ControlsProps = {
  fleet: SupervisorFleet | undefined; selected: SupervisorControl | undefined; scope: string;
  onScope: (scope: string) => void; onChanged: () => Promise<unknown>;
};

function ScopePicker({ scope, fleet, selected, onScope }: Omit<ControlsProps, "onChanged">) {
  return <label>Supervisor<select aria-label="Supervisor" value={scope} onChange={event => onScope(event.target.value)}>
    <option value="global">Global supervisor</option>
    {fleet?.supervisors.filter(supervisor => supervisor.project_id).map(supervisor =>
      <option key={supervisor.id} value={`project:${supervisor.project_id}`}>{supervisor.label}</option>)}
    {scope !== "global" && !selected && <option value={scope}>Project supervisor unavailable</option>}
  </select></label>;
}

export function SupervisorControls({ fleet, selected, scope, onScope, onChanged }: ControlsProps) {
  const disclosure = useMobileControls(scope, selected);
  return <details className={styles.controlDisclosure} open={disclosure.open} onToggle={event => disclosure.toggle(event.currentTarget.open)}>
    <summary><span>Supervisor controls</span><span>{phaseLabel(selected)}</span></summary>
    <div className={styles.management} aria-label="Supervisor controls">
      <ScopePicker scope={scope} selected={selected} fleet={fleet} onScope={onScope} />
      {selected && fleet ? <Settings key={selected.id} value={selected} fleet={fleet} onChanged={onChanged} /> : <span role="status">Supervisor controls unavailable</span>}
    </div>
  </details>;
}

type SettingsProps = { value: SupervisorControl; fleet: SupervisorFleet; onChanged: () => Promise<unknown> };
type Profile = SupervisorFleet["profiles"][number];
type Stored = SupervisorControl["profile"];

function storedProfileKey(stored: Stored) {
  if (!stored?.profile_id || !stored.candidate_id) return null;
  return key({ profile_id: stored.profile_id, candidate_id: stored.candidate_id });
}

function selectedProfile(profiles: Profile[], selected: string, stored: Stored) {
  const storedKey = storedProfileKey(stored);
  const chosen = profiles.find(profile => key(profile) === selected);
  if (chosen) return chosen;
  if (stored) return profiles.find(profile => key(profile) === storedKey);
  return profiles.find(profile => profile.profile_id === "standard-medium") ?? profiles[0];
}

function profileDescription(profile: Partial<Profile>) {
  const harness = profile.harness === "claude" ? "Claude" : profile.harness === "codex" ? "Codex" : profile.harness;
  return [harness, profile.name ?? profile.profile_id, profile.model, profile.reasoning].filter(Boolean).join(" · ");
}

function profilePlaceholder(profiles: Profile[], stored: Stored) {
  if (!profiles.length) return "No level available";
  const name = stored && profileDescription(stored);
  return name ? `Choose a level (was ${name})` : "Choose a level";
}

function receiptMessage(error: unknown, inspect: boolean) {
  const missing = error instanceof ApiError && error.status === 404;
  if (inspect && missing) return "No receipt found. Retry the same change.";
  return "Confirmation pending. Check the receipt or retry the same change.";
}

function definiteRejection(error: unknown): error is ApiError {
  return error instanceof ApiError && [400, 401, 403, 409, 422].includes(error.status ?? 0);
}

function useSupervisorChange(supervisor: SupervisorControl, onChanged: SettingsProps["onChanged"]) {
  const client = useQueryClient();
  const [pending, setPending] = useDraft<SupervisorIntent | null>(`supervisor-control:${supervisor.id}`, null, validIntent);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const lock = useRef(false), alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  async function failed(error: unknown, inspect: boolean) {
    if (!alive.current) return;
    if (!definiteRejection(error)) {
      setError(receiptMessage(error, inspect));
      return;
    }
    setPending(null);
    setError(error.serverMessage ?? "Supervisor settings changed. Refresh and try again.");
    await onChanged();
  }

  async function submit(intent: SupervisorIntent, inspect = false) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const send = inspect ? inspectSupervisorControl : setSupervisor;
      await send(supervisor.id, intent);
      if (!alive.current) return;
      setPending(null);
      await onChanged();
      await client.invalidateQueries({ predicate: query => query.queryKey.includes("bootstrap") || query.queryKey.includes("supervisor-global") });
    } catch (error) {
      await failed(error, inspect);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }

  function change(enabled: boolean, profile?: Profile) {
    if (lock.current || pending) return;
    if (enabled && !profile) return;
    const intent: SupervisorIntent = { operation_id: crypto.randomUUID(), expected_revision: supervisor.revision, enabled };
    if (enabled && profile) intent.intelligence_profile = selectionOf(profile);
    setPending(intent);
    void submit(intent);
  }
  return { pending, busy, error, submit, change };
}

type Change = ReturnType<typeof useSupervisorChange>;
function PendingButtons({ intent, busy, submit }: Pick<Change, "busy" | "submit"> & { intent: SupervisorIntent }) {
  return <>
    <ActionButton disabled={busy} onClick={() => void submit(intent)}>Retry same change</ActionButton>
    <ActionButton disabled={busy} onClick={() => void submit(intent, true)}>Check change</ActionButton>
  </>;
}

function ChangeButtons({ change, supervisor, current }: { change: Change; supervisor: SupervisorControl; current?: Profile }) {
  const { pending, busy, submit } = change;
  if (pending) return <PendingButtons intent={pending} busy={busy} submit={submit} />;
  if (supervisor.enabled) return <>
    <ActionButton disabled={busy} onClick={() => change.change(false)}>Stop supervisor</ActionButton>
    {current && key(current) !== storedProfileKey(supervisor.profile) &&
      <ActionButton disabled={busy} onClick={() => change.change(true, current)}>Apply level</ActionButton>}
  </>;
  const canStart = !!current && supervisor.phase !== "uncertain";
  return <ActionButton disabled={busy || !canStart} onClick={() => change.change(true, current)}>Start supervisor</ActionButton>;
}

function SupervisorStatus({ supervisor }: { supervisor: SupervisorControl }) {
  return <>
    <span role="status" title={supervisor.stage}>{phaseLabel(supervisor)}</span>
    {supervisor.unavailable_reason && <span className={styles.runtime} role="status" data-supervisor-unavailable="">
      {supervisor.enabled ? "Enabled but not running" : "Will not start"}: {supervisor.unavailable_reason}
    </span>}
    {(supervisor.phase === "failed" || supervisor.phase === "uncertain") && <span>{supervisor.last_error ?? supervisor.stage}</span>}
  </>;
}

function ProfilePicker({ profiles, stored, current, disabled, select }: {
  profiles: Profile[]; stored: Stored; current?: Profile; disabled: boolean; select: (value: string) => void;
}) {
  return (
    <label>Level<select aria-label="Supervisor level" value={current ? key(current) : ""} disabled={disabled} onChange={e => select(e.target.value)}>
      {!current && <option value="" disabled>{profilePlaceholder(profiles, stored)}</option>}
      {profiles.map(profile => <option key={key(profile)} value={key(profile)}>{profileDescription(profile)}</option>)}
    </select></label>
  );
}

function Settings({ value: supervisor, fleet, onChanged }: SettingsProps) {
  const [selected, select] = useState("");
  const change = useSupervisorChange(supervisor, onChanged);
  // A stored choice missing from the active catalog requires an explicit replacement.
  const current = selectedProfile(fleet.profiles, selected, supervisor.profile);
  return <>
    <ProfilePicker profiles={fleet.profiles} stored={supervisor.profile} current={current} disabled={change.busy || !!change.pending} select={select} />
    <ChangeButtons supervisor={supervisor} change={change} current={current} />
    <SupervisorStatus supervisor={supervisor} />
    {!fleet.profiles.length && <Link to="/settings?tab=intelligence">Add a supervisor model to a level</Link>}
    {change.error && <span role="status">{change.error}</span>}
  </>;
}
