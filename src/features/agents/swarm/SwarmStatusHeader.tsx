import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { adaptConfiguredProviders } from "../../../api/adapters/configuredProviders";
import { queryKey } from "../../../api/queryKeys";
import { Link } from "react-router";
import { useSwarmSettings, useUpdateSwarmLimits, type UpdateSwarmLimits } from "../../../api/swarmSettings";
import { apiGet, ApiError, isProtectedReadFailure } from "../../../api/client";
import { ContractError } from "../../../api/adapters/contract";
import { useSession } from "../../../app/session";
import { ProviderBurn } from "./ProviderBurn";
import styles from "./SwarmStatusHeader.module.css";

function storageKey(principal: string) { return `aq.swarm.status.expanded:${principal}`; }
function stored(principal: string) {
  try { return localStorage.getItem(storageKey(principal)) === "true"; } catch { return false; }
}
const MAX_LIMIT = 4_294_967_295;
function integer(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= MAX_LIMIT ? parsed : null;
}

export function SwarmStatusHeader() {
  const { queryContext, bootstrap } = useSession();
  const configured = useQuery({
    queryKey: queryKey(queryContext, "configured-provider-accounts", { contract: "human-provider-accounts-1" }),
    queryFn: async ({ signal }) => adaptConfiguredProviders(await apiGet<unknown>("/api/human/provider-accounts", AbortSignal.any([signal, AbortSignal.timeout(15_000)]))),
    enabled: bootstrap.capability("providers.configured.read").enabled, retry: false, refetchInterval: 60_000,
  });
  const configuredProviders = configured.isError ? undefined : configured.data?.accounts.filter(account => account.enabled).map(account => account.provider);
  return <StatusHeader key={queryContext.principalId} principal={queryContext.principalId} configuredProviders={configuredProviders} />;
}

function StatusHeader({ principal, configuredProviders }: { principal: string; configuredProviders?: string[] }) {
  const [open, setOpen] = useState(() => stored(principal));
  const id = useId();
  const settings = useSwarmSettings();
  const config = settings.isError && isProtectedReadFailure(settings.error) ? undefined : settings.data;
  const cells = config?.cells ?? [];
  const unclassified = config?.unclassified ?? [];
  const total = (field: "running" | "waiting") => cells.length && cells.every(cell => cell[field] !== null)
    ? cells.reduce((sum, cell) => sum + cell[field]!, 0) + unclassified.reduce((sum, item) => sum + item[field], 0) : null;
  const providers = [...new Set([...(config?.provider_limits ?? []).map(item => item.provider), ...cells.map(cell => cell.provider), ...unclassified.map(item => item.provider), ...(configuredProviders ?? [])])].filter(provider =>
    configuredProviders === undefined || configuredProviders.includes(provider) ||
    config?.provider_limits?.some(item => item.provider === provider && item.limit !== null) ||
    cells.some(cell => cell.provider === provider && ((cell.running ?? 0) > 0 || (cell.waiting ?? 0) > 0)) ||
    unclassified.some(item => item.provider === provider && (item.running > 0 || item.waiting > 0))
  );
  const toggle = () => setOpen(previous => {
    const next = !previous;
    try { localStorage.setItem(storageKey(principal), String(next)); } catch { /* session-only preference */ }
    return next;
  });
  return <section className={styles.status} aria-label="Swarm status">
    <div className={styles.summary}>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={toggle}>{open ? "Hide details ▴" : "Show details ▾"}</button>
      <span className={styles.counts}><strong>{total("running") == null ? "Active unknown" : `${total("running")} active`}</strong> · {total("waiting") == null ? "waiting unknown" : `${total("waiting")} waiting`}</span>
    </div>
    <div id={id} hidden={!open} className={styles.details}>
      <div className={styles.intro}><div><strong>Provider allocation</strong><p className={styles.note}>Maximum concurrent agents across all projects and machines. Zero pauses new starts; running agents finish. Burn estimates require at least five minutes of fresh usage history.</p></div><Link to="/settings?tab=intelligence">Intelligence settings</Link></div>
      {settings.isError && <p role="alert">Provider limits could not be refreshed. Reload before applying changes.</p>}
      {!config && settings.isPending && <p role="status">Loading provider limits…</p>}
      {config && config.provider_limits === undefined && <p role="alert">Provider limits are unavailable on this server.</p>}
      {config && config.provider_limits !== undefined && providers.length === 0 && <p className={styles.note}>No providers configured.</p>}
      {config && config.provider_limits !== undefined && <div className={styles.providerGrid}>{providers.map(provider => <ProviderAllocation key={provider} provider={provider} limit={config.provider_limits?.find(item => item.provider === provider)?.limit ?? null} revision={config.revision} catalogRevision={config.catalog_revision} active={settings.isError ? null : (() => { const matches = cells.filter(cell => cell.provider === provider); return matches.length && matches.every(cell => cell.running !== null) ? matches.reduce((sum, cell) => sum + cell.running!, 0) + unclassified.filter(item => item.provider === provider).reduce((sum, item) => sum + item.running, 0) : null; })()} readFailed={settings.isError || !cells.some(cell => cell.provider === provider)} reload={async () => { const result = await settings.refetch(); if (result.isError || !result.data) throw result.error; return result.data; }} />)}</div>}
    </div>
  </section>;
}

function ProviderAllocation({ provider, limit, revision, catalogRevision, active, readFailed, reload }: { provider: string; limit: number | null; revision: string; catalogRevision: string; active: number | null; readFailed: boolean; reload(): Promise<{ revision: string; catalog_revision: string; provider_limits?: { provider: string; limit: number | null }[] }> }) {
  const mutation = useUpdateSwarmLimits();
  const [draft, setDraft] = useState<string | null>(limit === null ? null : String(limit));
  const [base, setBase] = useState({ limit, revision, catalogRevision });
  const [uncertain, setUncertain] = useState<UpdateSwarmLimits | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  // Polls update clean controls, but never overwrite an edit in progress.
  const dirty = draft === null ? base.limit !== null : integer(draft) !== base.limit;
  if (!dirty && !uncertain && (base.revision !== revision || base.catalogRevision !== catalogRevision || base.limit !== limit)) {
    setBase({ limit, revision, catalogRevision });
    setDraft(limit === null ? null : String(limit));
    setConflict(false);
  }
  const stale = dirty && (base.revision !== revision || base.catalogRevision !== catalogRevision);
  const number = draft === null ? null : integer(draft);
  const invalid = draft !== null && number === null;
  const busy = mutation.isPending;
  function submit(request: UpdateSwarmLimits) {
    setError(null);
    mutation.mutate(request, { onSuccess: result => {
      const saved = result.provider_limits?.find(item => item.provider === provider)?.limit ?? null;
      setBase({ limit: saved, revision: result.revision, catalogRevision: result.catalog_revision });
      setDraft(saved === null ? null : String(saved)); setUncertain(null); setConflict(false);
    }, onError: cause => {
      if ((cause instanceof ApiError && (cause.effectUnknown || cause.kind === "contract" || (cause.status !== undefined && cause.status >= 500))) || cause instanceof ContractError) {
        setUncertain(request); setError("Update outcome unknown. Retry the same operation to confirm.");
      } else if (cause instanceof ApiError && cause.status === 409) {
        setUncertain(null); setConflict(true); setError("Limits changed. Reload and review before applying.");
      } else { setUncertain(null); setError("Update failed. Your draft is preserved."); }
    } });
  }
  const blocked = busy || !!uncertain || conflict || stale || readFailed;
  const max = Math.max(32, limit ?? 0, number ?? 0);
  return <div className={styles.provider}>
    <div className={styles.providerHeading}><strong>{provider}</strong><span>{draft === null ? "Unlimited" : invalid ? "Invalid limit" : `${number} concurrent${number === 0 ? " · paused" : ""}`}{dirty && " · draft"}</span></div>
    <div className={styles.controls}>
      <input type="range" aria-label={`${provider} concurrent agents`} min="0" max={max} step="1" value={number ?? 0} aria-valuetext={draft === null ? "Unlimited" : undefined} disabled={blocked} onChange={event => setDraft(event.currentTarget.value)} />
      <input type="number" aria-label={`${provider} limit`} min="0" max={MAX_LIMIT} step="1" value={draft ?? ""} placeholder="Unlimited" disabled={blocked || draft === null} onChange={event => setDraft(event.currentTarget.value)} />
      <label><input type="checkbox" aria-label={`${provider} unlimited`} checked={draft === null} disabled={blocked} onChange={event => setDraft(event.currentTarget.checked ? null : "0")} /> Unlimited</label>
      <button type="button" disabled={blocked || !dirty || invalid} onClick={() => submit({ operation_id: crypto.randomUUID(), expected_revision: base.revision, expected_catalog_revision: base.catalogRevision, provider: { provider, limit: number } })}>{busy ? "Applying…" : "Apply"}</button>
    </div>
    <ProviderBurn provider={provider} proposedLimit={invalid ? null : number} active={active} />
    {(stale || conflict) && <p role="alert">Limits changed while editing. Reload to review current values. <button type="button" disabled={busy || !!uncertain} onClick={() => { void reload().then(result => { const current = result.provider_limits?.find(item => item.provider === provider)?.limit ?? null; setBase({ limit: current, revision: result.revision, catalogRevision: result.catalog_revision }); setDraft(current === null ? null : String(current)); setConflict(false); setError(null); }).catch(() => setError("Could not reload limits. Your draft is preserved.")); }}>Reload limits</button></p>}
    {invalid && <p role="alert">Enter a whole number from 0 to {MAX_LIMIT.toLocaleString()}.</p>}
    {error && <p role="alert">{error} {uncertain && <button type="button" disabled={busy} onClick={() => submit(uncertain)}>Retry same update</button>}</p>}
  </div>;
}
