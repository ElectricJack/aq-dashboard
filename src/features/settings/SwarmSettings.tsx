import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { ApiError } from "../../api/client";
import { inspectSwarmOperation, useSaveSwarmSettings, useSwarmSettings, type SaveSwarmSettings, type SwarmCell, type SwarmCellLimit, type SwarmSettings as SettingsSnapshot } from "../../api/swarmSettings";
import { ActionButton, Panel } from "../../components/layout/Workspace";
import styles from "./SwarmSettings.module.css";

type Values = Record<string, string>;
const MAX_LIMIT = 4_294_967_295;
const key = (cell: Pick<SwarmCell, "provider" | "intelligence_class">) => JSON.stringify([cell.provider, cell.intelligence_class]);
function values(settings: SettingsSnapshot, profile: "normal" | "reduced"): Values {
  return Object.fromEntries(settings.cells.map(cell => [key(cell), cell[`${profile}_limit`] === null ? "" : String(cell[`${profile}_limit`])]));
}
function integer(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 && number <= MAX_LIMIT ? number : null;
}
function invalidNumber(value: string | undefined) {
  return Number(value) > MAX_LIMIT ? "Enter a whole number from 0 to 4,294,967,295." : "Enter a non-negative whole number.";
}
function matrix(cells: SwarmCell[], input: Values): SwarmCellLimit[] {
  return cells.map(cell => ({ provider: cell.provider, intelligence_class: cell.intelligence_class, limit: integer(input[key(cell)])! }));
}
function sameMatrix(a: SwarmCellLimit[] | null, b: SwarmCellLimit[] | null) {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every(cell => b.some(other => key(cell) === key(other) && cell.limit === other.limit));
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
  const stale = dirty && (settings.revision !== base.revision || settings.catalog_revision !== base.catalog_revision);
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
  const issues: Record<string, string> = {};
  for (const cell of base.cells) {
    const id = key(cell), n = integer(normal[id]), r = integer(reduced[id]);
    if (n === null) issues[`normal${id}`] = invalidNumber(normal[id]);
    if (hasReduced && r === null) issues[`reduced${id}`] = invalidNumber(reduced[id]);
    else if (hasReduced && n !== null && r !== null && r > n) issues[`reduced${id}`] = "Reduced must be at or below Normal.";
  }
  const invalid = Object.keys(issues).length > 0;
  function edited() { setDirty(true); setNotice(null); if (!blocked) setError(null); }
  function complete(confirmed: SettingsSnapshot, request: SaveSwarmSettings) {
    if (!sameMatrix(confirmed.normal, request.normal) || !sameMatrix(confirmed.reduced, request.reduced)) throw Error("Unconfirmed limits");
    reset(BigInt(settings.revision) > BigInt(confirmed.revision) ? settings : confirmed);
    setUnconfirmed(null); setRetrySame(false); setNotice("Limits saved. Running agents continue.");
  }
  async function send(request: SaveSwarmSettings) {
    if (lock.current || busy) return;
    lock.current = true; setError(null); setNotice(null);
    try {
      complete(await save.mutateAsync(request), request);
    } catch (cause) {
      const conflict = cause instanceof ApiError && cause.status === 409;
      const refused = cause instanceof ApiError && cause.status !== undefined && cause.status >= 400 && cause.status < 500;
      setBlocked(true);
      setUnconfirmed(refused ? null : request); setRetrySame(false);
      setError(conflict ? "Swarm settings changed. Your edits are preserved. Reload saved limits before trying again."
        : refused ? `${cause.serverMessage ?? "AQ refused these limits."} Your edits are preserved. Reload saved limits before trying again.`
          : "Save not confirmed. Your edits are preserved. Check save status before making another change.");
    } finally { lock.current = false; }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current || busy || blocked || stale || readFailed || invalid || !dirty || !base.cells.length) return;
    void send({ operation_id: crypto.randomUUID(), expected_revision: base.revision, expected_catalog_revision: base.catalog_revision,
      normal: matrix(base.cells, normal), reduced: hasReduced ? matrix(base.cells, reduced) : null });
  }
  async function check() {
    if (!unconfirmed || lock.current || busy) return;
    lock.current = true; setReloading(true);
    try { complete(await inspectSwarmOperation(unconfirmed.operation_id), unconfirmed); setError(null); }
    catch (cause) {
      const missing = cause instanceof ApiError && cause.status === 404;
      setRetrySame(missing);
      setError(missing ? "Save not recorded yet. Retry the same save safely." : "Save status is unavailable. Your edits are preserved.");
    } finally { lock.current = false; setReloading(false); }
  }
  async function refresh() {
    if (lock.current || busy) return;
    lock.current = true; setReloading(true);
    try { reset(await reload()); setError(null); setNotice("Saved limits reloaded. Review the current values before editing."); }
    catch { setError("Could not reload saved limits. Your edits are preserved."); }
    finally { lock.current = false; setReloading(false); }
  }
  const providers = [...new Set(base.cells.map(cell => cell.provider))];
  const classes = [...new Map(base.cells.map(cell => [cell.intelligence_class, cell.display_name])).entries()];
  const unclassifiedActive = settings.unclassified.reduce((total, item) => total + item.running, 0);
  const unclassifiedWaiting = settings.unclassified.reduce((total, item) => total + item.waiting, 0);
  function renderMatrix(profile: "normal" | "reduced") {
    const label = profile === "normal" ? "Normal" : "Reduced usage", input = profile === "normal" ? normal : reduced;
    const hintId = `${prefix}-${profile}-scroll`;
    return <><p id={hintId} className={styles.scrollHint}>Scroll horizontally to see all intelligence classes.</p><div className={styles.tableWrap} role="region" aria-label={`${label} concurrency matrix`} aria-describedby={hintId} tabIndex={0}>
      <table className={styles.table} style={{ minInlineSize: `${Math.max(440, (classes.length + 1) * 170)}px` }}>
        <caption className={styles.srOnly}>{label} concurrency limits</caption>
        <thead><tr><th scope="col">Provider</th>{classes.map(([id, name]) => <th key={id} scope="col">{name}</th>)}</tr></thead>
        <tbody>{providers.map(provider => <tr key={provider}><th scope="row">{provider}</th>{classes.map(([intelligenceClass, name], index) => {
          const cell = base.cells.find(c => c.provider === provider && c.intelligence_class === intelligenceClass);
          if (!cell) return <td key={intelligenceClass}><span className={styles.meta}>Unavailable</span></td>;
          const id = key(cell), contextId = `${prefix}-${profile}-${providers.indexOf(provider)}-${index}`;
          const live = settings.cells.find(c => key(c) === id);
          const issue = dirty ? issues[`${profile}${id}`] : undefined;
          return <td key={intelligenceClass}>
            <input ref={profile === "reduced" && id === key(base.cells[0]!) ? firstReduced : undefined} type="number" inputMode="numeric" min="0" step="1" max={MAX_LIMIT} required
              aria-label={`${label} ${provider} ${name} limit`} aria-describedby={`${contextId}${issue ? ` ${contextId}-error` : ""}`} aria-invalid={!!issue}
              value={input[id] ?? ""} placeholder="Not set" disabled={busy || blocked || stale}
              onChange={event => { edited(); (profile === "normal" ? setNormal : setReduced)(current => ({ ...current, [id]: event.target.value })); }} />
            <span id={contextId} className={styles.context}>
              <span>{live?.running === null || live?.running === undefined ? "Active unknown" : `${live.running} active`} / {live?.effective_limit === null || live?.effective_limit === undefined ? "limit not set" : `limit ${live.effective_limit}`}</span>
              <span>{live?.waiting === null || live?.waiting === undefined ? "Waiting unknown" : `${live.waiting} waiting`}</span>
              {live?.effective_limit === 0 && <span>New starts paused</span>}
              {live?.running !== null && live?.running !== undefined && live.effective_limit !== null && live.running > live.effective_limit && <span>Existing agents finish</span>}
            </span>
            {issue && <span id={`${contextId}-error`} className={styles.fieldError}>{issue}</span>}
          </td>;
        })}</tr>)}</tbody>
      </table>
    </div></>;
  }
  return <form className={styles.editor} onSubmit={event => void submit(event)} noValidate>
    <div className={styles.intro}>
      <p>Set how many agents may run at once for each provider and intelligence class, shared across all projects and machines.</p>
      <p className={styles.meta}>Changes affect new starts. Running agents finish. Zero pauses new starts. Tasks keep their required class and wait for a matching slot. Counts show the saved active profile. Active includes running agents and reserved starts. Waiting counts reflect recently observed blocked work.</p>
      <p className={styles.active}>{settings.active_mode === "reduced" ? "Reduced usage limits active" : "Normal limits active"}</p>
      {(unclassifiedActive > 0 || unclassifiedWaiting > 0) && <p className={styles.meta}>{unclassifiedActive} active {unclassifiedActive === 1 ? "agent" : "agents"} and {unclassifiedWaiting} waiting {unclassifiedWaiting === 1 ? "task" : "tasks"} have no current intelligence class. Active agents still count toward provider capacity until they finish.</p>}
    </div>
    {readFailed && <p role="alert">Current swarm state could not be refreshed. Displayed counts may be stale. Reload saved limits before saving.</p>}
    {stale && !blocked && <p role="alert">Swarm settings changed. Your edits are preserved. Reload saved limits before trying again.</p>}
    <Panel title="Normal limits" description="Maximum concurrent agents for every available provider and intelligence class.">
      {base.cells.length ? renderMatrix("normal") : <p>No provider and intelligence class combinations are configured. Configure intelligence profiles first.</p>}
    </Panel>
    <Panel title="Reduced usage limits" description="The Swarm switch applies this saved profile. Each value must be at or below its Normal limit.">
      {hasReduced ? <>{renderMatrix("reduced")}<div className={styles.optional}>
        <ActionButton disabled={busy || blocked || stale || settings.active_mode === "reduced"} onClick={() => { edited(); profileFocus.current = "configure"; setHasReduced(false); }}>Remove reduced usage profile</ActionButton>
        {settings.active_mode === "reduced" && <p className={styles.meta}>Switch to Normal on Swarm before removing this profile.</p>}
      </div></> : <div className={styles.optional}><p className={styles.meta}>No Reduced usage profile is saved. Configure limits before turning on Reduced usage.</p>
        <ActionButton ref={configureButton} disabled={busy || blocked || stale || !base.cells.length} onClick={() => { edited(); profileFocus.current = "reduced"; setHasReduced(true); }}>Configure reduced usage</ActionButton></div>}
    </Panel>
    {dirty && invalid && <p className={styles.warning} role="status">Enter non-negative whole numbers in every available cell. Reduced limits cannot exceed Normal limits.</p>}
    <div className={styles.actions}>
      <ActionButton type="submit" className={styles.save} disabled={!dirty || invalid || busy || blocked || stale || readFailed || !base.cells.length}>{save.isPending ? "Saving limits…" : "Save limits"}</ActionButton>
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
