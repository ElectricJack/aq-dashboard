import { useId, useState } from "react";
import { Link } from "react-router";
import { useSetSwarmMode, useSwarmSettings, type SetSwarmMode } from "../../../api/swarmSettings";
import { ApiError, isProtectedReadFailure } from "../../../api/client";
import { ContractError } from "../../../api/adapters/contract";
import { useProviderUsage } from "../../../app/useProviderUsage";
import { useSession } from "../../../app/session";
import { ProviderUsageStrip, ProviderUsageSummary } from "../../../components/ProviderUsageStrip/ProviderUsageStrip";
import styles from "./SwarmStatusHeader.module.css";

function storageKey(principal: string) { return `aq.swarm.status.expanded:${principal}`; }
function stored(principal: string) {
  try { return localStorage.getItem(storageKey(principal)) === "true"; } catch { return false; }
}

export function SwarmStatusHeader() {
  const { queryContext } = useSession();
  const principal = queryContext.principalId;
  // Key the preference by principal so a shared device does not disclose another viewer's choice.
  return <StatusHeader key={principal} principal={principal} />;
}

function StatusHeader({ principal }: { principal: string }) {
  const [open, setOpen] = useState(() => stored(principal));
  const id = useId();
  const usage = useProviderUsage();
  const settings = useSwarmSettings();
  const mode = useSetSwarmMode();
  const config = settings.isError && isProtectedReadFailure(settings.error) ? undefined : settings.data;
  const [uncertain, setUncertain] = useState<SetSwarmMode | null>(null);
  const submit = (request: SetSwarmMode) => {
    mode.mutate(request, { onSuccess: () => setUncertain(null), onError: error => {
      if ((error instanceof ApiError && (error.effectUnknown || error.kind === "contract" || (error.status !== undefined && error.status >= 500))) || error instanceof ContractError) setUncertain(request);
      else setUncertain(null);
    } });
  };
  const cells = config?.cells ?? [];
  const unclassified = config?.unclassified ?? [];
  const total = (field: "running" | "waiting") => cells.length && cells.every(cell => cell[field] !== null)
    ? cells.reduce((sum, cell) => sum + cell[field]!, 0) + unclassified.reduce((sum, item) => sum + item[field], 0) : null;
  const counts = new Map<string, { running: number | null; waiting: number | null }>();
  for (const cell of cells) {
    const entry = counts.get(cell.provider) ?? { running: 0, waiting: 0 };
    entry.running = entry.running === null || cell.running === null ? null : entry.running + cell.running;
    entry.waiting = entry.waiting === null || cell.waiting === null ? null : entry.waiting + cell.waiting;
    counts.set(cell.provider, entry);
  }
  for (const item of unclassified) {
    const entry = counts.get(item.provider) ?? { running: 0, waiting: 0 };
    entry.running = entry.running === null ? null : entry.running + item.running;
    entry.waiting = entry.waiting === null ? null : entry.waiting + item.waiting;
    counts.set(item.provider, entry);
  }
  const toggle = () => setOpen(previous => {
    const next = !previous;
    try { localStorage.setItem(storageKey(principal), String(next)); } catch { /* session-only preference */ }
    return next;
  });
  return <section className={styles.status} aria-label="Swarm status">
    <div className={styles.summary}>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={toggle}>{open ? "Hide details ▴" : "Show details ▾"}</button>
      <span className={styles.counts}><strong>{total("running") == null ? "Active unknown" : `${total("running")} active`}</strong> · {total("waiting") == null ? "waiting unknown" : `${total("waiting")} waiting`}</span>
      <span className={styles.usage}><ProviderUsageSummary state={usage.state} /></span>
      <span className={styles.mode}>{config ? (config.active_mode === "reduced" ? "Reduced limits active" : "Normal limits") : settings.isPending ? "Loading mode…" : "Mode unavailable"}{settings.isError && config && " · stale"}</span>
      <label className={styles.switch}><input type="checkbox" role="switch" checked={config?.active_mode === "reduced"} disabled={!config || settings.isError || mode.isPending || !!uncertain || (config.reduced === null && config.active_mode !== "reduced")} onChange={event => { if (config) submit({ operation_id: crypto.randomUUID(), expected_revision: config.revision, active_mode: event.currentTarget.checked ? "reduced" : "normal" }); }} />Reduced usage</label>
      <Link to="/settings#swarm">{config && config.reduced === null ? "Configure reduced usage" : "Adjust limits"}</Link>
      {mode.isPending && <span role="status">Updating mode…</span>}
      {mode.isError && <span role="alert">{uncertain ? "Mode update outcome unknown. Retry the same operation to confirm." : "Mode update failed. Check settings before trying again."}</span>}
      {uncertain && <button type="button" disabled={mode.isPending} onClick={() => submit(uncertain)}>Retry mode update</button>}
    </div>
    <div id={id} hidden={!open} className={styles.details}>
      <p className={styles.note}>Active includes running and starting agents. Waiting shows recently observed work awaiting slots.</p>
      {unclassified.length > 0 && <p className={styles.note}>Totals include agents and waiting tasks in historical or unclassified provider classes.</p>}
      {counts.size > 0 && <div className={styles.breakdown} aria-label="Agents by provider">
        {[...counts].map(([provider, count]) => <div key={provider}><strong>{provider}</strong> · {count.running === null ? "active unknown" : `${count.running} active`} · {count.waiting === null ? "waiting unknown" : `${count.waiting} waiting`}</div>)}
      </div>}
      <ProviderUsageStrip state={usage.state} />
    </div>
  </section>;
}
