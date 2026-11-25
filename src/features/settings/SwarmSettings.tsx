import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { isHttpClientError, ApiError } from "../../api/client";
import { inspectSwarmOperation, useSaveSwarmSettings, useSwarmSettings, type SaveSwarmSettings, type SwarmSettings as SettingsSnapshot } from "../../api/swarmSettings";
import { ActionButton, Panel } from "../../components/layout/Workspace";
import { matrix, matrixIssues, sameMatrix, values } from "./swarmLimitMatrix";
import { SwarmLimitTable } from "./SwarmLimitTable";
import styles from "./SwarmSettings.module.css";

function saveFailure(cause: unknown) {
  if (!isHttpClientError(cause)) return { refused: false, text: "Save not confirmed. Your edits are preserved. Check save status before making another change." };
  const text = cause.status === 409 ? "Swarm settings changed. Your edits are preserved. Reload saved limits before trying again."
    : `${cause.serverMessage ?? "AQ refused these limits."} Your edits are preserved. Reload saved limits before trying again.`;
  return { refused: true, text };
}

export function SwarmSettings() {
  const query = useSwarmSettings();
  if (!query.data) return <Panel title="Concurrency limits">
    {query.isPending ? <p role="status">Loading swarm limits…</p> : <><p role="alert">Swarm limits are unavailable. Try again when connected.</p><ActionButton onClick={() => void query.refetch()}>Retry loading limits</ActionButton></>}
  </Panel>;
  return <SwarmEditor settings={query.data} refreshing={query.isFetching} readFailed={query.isError} reload={async () => {
    const result = await query.refetch();
    if (result.isError || !result.data) throw result.error ?? Error("Limits unavailable");
    return result.data;
  }} />;
}

function SwarmIntroduction({ settings }: { settings: SettingsSnapshot }) {
  const unclassifiedActive = settings.unclassified.reduce((total, item) => total + item.running, 0);
  const unclassifiedWaiting = settings.unclassified.reduce((total, item) => total + item.waiting, 0);
  return <div className={styles.intro}>
      <p>Set how many agents may run at once for each provider and intelligence class, shared across all projects and machines.</p>
      <p className={styles.meta}>Changes affect new starts. Running agents finish. Zero pauses new starts. Tasks keep their required class and wait for a matching slot. Counts show the saved active profile. Active includes running agents and reserved starts. Waiting counts reflect recently observed blocked work.</p>
      <p className={styles.active}>{settings.active_mode === "reduced" ? "Reduced usage limits active" : "Normal limits active"}</p>
      {(unclassifiedActive > 0 || unclassifiedWaiting > 0) && <p className={styles.meta}>{unclassifiedActive} active {unclassifiedActive === 1 ? "agent" : "agents"} and {unclassifiedWaiting} waiting {unclassifiedWaiting === 1 ? "task" : "tasks"} have no current intelligence class. Active agents still count toward provider capacity until they finish.</p>}
    </div>;
}

function SwarmEditor({ settings, refreshing, readFailed, reload }: { settings: SettingsSnapshot; refreshing: boolean; readFailed: boolean; reload(): Promise<SettingsSnapshot> }) {
  const save = useSaveSwarmSettings();
  const [base, setBase] = useState(settings);
  const [normal, setNormal] = useState(() => values(settings, "normal"));
  const [reduced, setReduced] = useState(() => values(settings, "reduced"));
  const [hasReduced, setHasReduced] = useState(settings.reduced !== null);
  const [dirty, setDirty] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState<SaveSwarmSettings | null>(null);
  const [retrySame, setRetrySame] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const lock = useRef(false);
  const firstReduced = useRef<HTMLInputElement>(null), configureButton = useRef<HTMLButtonElement>(null);
  const profileFocus = useRef<"reduced" | "configure" | null>(null);
  const prefix = useId();
  const busy = save.isPending || reloading;
  const stale = dirty && (settings.revision !== base.revision);
  function reset(snapshot: SettingsSnapshot) {
    setBase(snapshot); setNormal(values(snapshot, "normal")); setReduced(values(snapshot, "reduced"));
    setHasReduced(snapshot.reduced !== null); setDirty(false); setBlocked(false);
  }
  // Background reads update a clean editor; edits retain their original revisions.
  useEffect(() => { if (!dirty && !blocked) reset(settings); }, [settings]);
  useEffect(() => {
    if (profileFocus.current === "reduced") firstReduced.current?.focus();
    else if (profileFocus.current === "configure") configureButton.current?.focus();
    profileFocus.current = null;
  }, [hasReduced]);
  const issues = matrixIssues(base.cells, normal, reduced, hasReduced);
  const invalid = Object.keys(issues).length > 0;
  const editorLocked = busy || blocked || stale;
  const canSave = dirty && !invalid && !editorLocked && !readFailed && base.cells.length > 0;
  const requestInFlight = () => lock.current || busy;
  function edited() { setDirty(true); setNotice(null); if (!blocked) setError(null); }
  function complete(confirmed: SettingsSnapshot, request: SaveSwarmSettings) {
    if (!sameMatrix(confirmed.normal, request.normal) || !sameMatrix(confirmed.reduced, request.reduced)) throw Error("Unconfirmed limits");
    reset(BigInt(settings.revision) > BigInt(confirmed.revision) ? settings : confirmed);
    setUnconfirmed(null); setRetrySame(false); setNotice("Limits saved. Running agents continue.");
  }
  async function send(request: SaveSwarmSettings) {
    if (requestInFlight()) return;
    lock.current = true; setError(null); setNotice(null);
    try {
      complete(await save.mutateAsync(request), request);
    } catch (cause) {
      const failure = saveFailure(cause);
      setBlocked(true);
      setUnconfirmed(failure.refused ? null : request);
      setRetrySame(false);
      setError(failure.text);
    } finally { lock.current = false; }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current || !canSave) return;
    void send({ operation_id: crypto.randomUUID(), expected_revision: base.revision,
      normal: matrix(base.cells, normal), reduced: hasReduced ? matrix(base.cells, reduced) : null });
  }
  async function check() {
    if (!unconfirmed) return;
    if (requestInFlight()) return;
    lock.current = true; setReloading(true);
    try { complete(await inspectSwarmOperation(unconfirmed.operation_id), unconfirmed); setError(null); }
    catch (cause) {
      const missing = cause instanceof ApiError && cause.status === 404;
      setRetrySame(missing);
      setError(missing ? "Save not recorded yet. Retry the same save safely." : "Save status is unavailable. Your edits are preserved.");
    } finally { lock.current = false; setReloading(false); }
  }
  async function refresh() {
    if (requestInFlight()) return;
    lock.current = true; setReloading(true);
    try { reset(await reload()); setError(null); setNotice("Saved limits reloaded. Review the current values before editing."); }
    catch { setError("Could not reload saved limits. Your edits are preserved."); }
    finally { lock.current = false; setReloading(false); }
  }
  function renderMatrix(profile: "normal" | "reduced") {
    const setValue = profile === "normal" ? setNormal : setReduced;
    const input = profile === "normal" ? normal : reduced;
    return <SwarmLimitTable profile={profile} base={base.cells} liveCells={settings.cells}
      input={input} prefix={prefix} issues={dirty ? issues : {}} editorLocked={editorLocked} firstReduced={firstReduced}
      onChange={(id, value) => { edited(); setValue(current => ({ ...current, [id]: value })); }} />;
  }
  return <form className={styles.editor} onSubmit={event => void submit(event)} noValidate>
    <SwarmIntroduction settings={settings} />
    {readFailed && <p role="alert">Current swarm state could not be refreshed. Displayed counts may be stale. Reload saved limits before saving.</p>}
    {stale && !blocked && <p role="alert">Swarm settings changed. Your edits are preserved. Reload saved limits before trying again.</p>}
    <Panel title="Normal limits" description="Maximum concurrent agents for every available provider and intelligence class.">
      {base.cells.length ? renderMatrix("normal") : <p>No provider and intelligence class combinations are configured. Configure intelligence profiles first.</p>}
    </Panel>
    <Panel title="Reduced usage limits" description="The Swarm switch applies this saved profile. Each value must be at or below its Normal limit.">
      {hasReduced ? <>{renderMatrix("reduced")}<div className={styles.optional}>
        <ActionButton disabled={editorLocked || settings.active_mode === "reduced"} onClick={() => { edited(); profileFocus.current = "configure"; setHasReduced(false); }}>Remove reduced usage profile</ActionButton>
        {settings.active_mode === "reduced" && <p className={styles.meta}>Switch to Normal on Swarm before removing this profile.</p>}
      </div></> : <div className={styles.optional}><p className={styles.meta}>No Reduced usage profile is saved. Configure limits before turning on Reduced usage.</p>
        <ActionButton ref={configureButton} disabled={editorLocked || !base.cells.length} onClick={() => { edited(); profileFocus.current = "reduced"; setHasReduced(true); }}>Configure reduced usage</ActionButton></div>}
    </Panel>
    {dirty && invalid && <p className={styles.warning} role="status">Enter non-negative whole numbers in every available cell. Reduced limits cannot exceed Normal limits.</p>}
    <div className={styles.actions}>
      <ActionButton type="submit" className={styles.save} disabled={!canSave}>{save.isPending ? "Saving limits…" : "Save limits"}</ActionButton>
      <ActionButton disabled={busy || refreshing || unconfirmed !== null} onClick={() => void refresh()}>{reloading ? "Checking…" : "Reload saved limits"}</ActionButton>
      {unconfirmed && <ActionButton disabled={busy} onClick={() => void check()}>Check save status</ActionButton>}
      {unconfirmed && retrySame && <ActionButton disabled={busy} onClick={() => void send(unconfirmed)}>Retry same save</ActionButton>}
      <Link to="/agents/swarm">Back to Swarm</Link>
    </div>
    {dirty && <p className={styles.meta}>Unsaved edits. Reload saved limits discards these edits.</p>}
    {error && <p role="alert">{error}</p>}
    <p role="status" aria-live="polite" className={styles.notice}>{busy ? reloading ? "Checking saved limits…" : "Saving limits. Waiting for server confirmation…" : notice}</p>
  </form>;
}
