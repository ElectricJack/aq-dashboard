import { useEffect, useRef, useState } from "react";
import { useProviderSettings } from "../../../api/providerSettings";
import { useQuery } from "@tanstack/react-query";
import { adaptConfiguredProviders } from "../../../api/adapters/configuredProviders";
import { queryKey } from "../../../api/queryKeys";
import { useSwarmSettings, useUpdateSwarmLimits, type UpdateSwarmLimits, type SwarmSettings } from "../../../api/swarmSettings";
import { apiGet, ApiError, isProtectedReadFailure } from "../../../api/client";
import { ContractError } from "../../../api/adapters/contract";
import { useSession } from "../../../app/session";
import { ProviderBurn } from "./ProviderBurn";
import styles from "./SwarmStatusHeader.module.css";

type Drafts = Record<string, number | null>;
export function SwarmStatusHeader() {
  const { queryContext, bootstrap } = useSession();
  const membership = useProviderSettings(bootstrap.capability("providers.configured.read").enabled);
  const configured = useQuery({
    queryKey: queryKey(queryContext, "configured-provider-accounts", { contract: "human-provider-accounts-1" }),
    queryFn: async ({ signal }) => adaptConfiguredProviders(await apiGet<unknown>("/api/human/provider-accounts", AbortSignal.any([signal, AbortSignal.timeout(15_000)]))),
    enabled: bootstrap.capability("providers.configured.read").enabled, retry: false, refetchInterval: 60_000,
  });
  const providers = configured.isError ? undefined : configured.data?.accounts.filter(account => account.enabled).map(account => account.provider);
  return <StatusHeader key={queryContext.principalId} configuredProviders={providers} addedProviders={membership.isError ? undefined : membership.data?.providers} />;
}

type Membership = { configuredProviders?: string[]; addedProviders?: string[] };
type LimitError = "unknown" | "conflict" | "failed" | "review";
function latestRevision(config: SwarmSettings, base?: SwarmSettings) {
  return !base || BigInt(config.revision) >= BigInt(base.revision);
}
function limitFailure(cause: unknown): LimitError {
  if (cause instanceof ContractError) return "unknown";
  if (!(cause instanceof ApiError)) return "failed";
  if (cause.effectUnknown || cause.kind === "contract") return "unknown";
  if ((cause.status ?? 0) >= 500) return "unknown";
  return cause.status === 409 ? "conflict" : "failed";
}
function remainingDrafts(drafts: Drafts, { provider, limit }: NonNullable<UpdateSwarmLimits["provider"]>) {
  const remaining = { ...drafts };
  if (remaining[provider] === limit) delete remaining[provider];
  return remaining;
}
function useLimitDrafts() {
  const settings = useSwarmSettings();
  const mutation = useUpdateSwarmLimits();
  const config = settings.isError && isProtectedReadFailure(settings.error) ? undefined : settings.data;
  const [drafts, setDrafts] = useState<Drafts>({});
  const draftsRef = useRef<Drafts>({});
  const base = useRef<SwarmSettings | undefined>(config);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<LimitError | null>(null);
  const errorRef = useRef<typeof error>(null);
  const uncertain = useRef<UpdateSwarmLimits | null>(null);
  function updateError(value: typeof error) { errorRef.current = value; setError(value); }
  function updateDrafts(value: Drafts) { draftsRef.current = value; setDrafts(value); }
  useEffect(() => {
    if (busy.current || errorRef.current) return;
    if (!Object.keys(draftsRef.current).length && config && latestRevision(config, base.current)) base.current = config;
  }, [config]);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function send(request: UpdateSwarmLimits) {
    busy.current = true; setPending(true); updateError(null);
    try {
      const result = await mutation.mutateAsync(request);
      base.current = result; uncertain.current = null;
      updateDrafts(remainingDrafts(draftsRef.current, request.provider!));
    } catch (cause) {
      const failure = limitFailure(cause);
      if (failure === "unknown") uncertain.current = request;
      updateError(failure);
    } finally {
      busy.current = false; setPending(false);
      if (!errorRef.current && Object.keys(draftsRef.current).length) timer.current = setTimeout(flush, 350);
    }
  }
  function flush() {
    if (busy.current || errorRef.current) return;
    if (!base.current || settings.isError) return;
    const entry = Object.entries(draftsRef.current)[0];
    if (!entry) return;
    void send({ operation_id: crypto.randomUUID(), expected_revision: base.current.revision, provider: { provider: entry[0], limit: entry[1] } });
  }
  function change(provider: string, limit: number | null) {
    updateDrafts({ ...draftsRef.current, [provider]: limit });
    clearTimeout(timer.current); timer.current = setTimeout(flush, 350);
  }
  async function reload() {
    try {
      const result = await settings.refetch();
      if (result.isError || !result.data) throw result.error;
      base.current = result.data; updateError("review");
    } catch { updateError("conflict"); }
  }
  function finishChange() { clearTimeout(timer.current); flush(); }
  function repeat() { if (uncertain.current) void send(uncertain.current); }
  function retry() { updateError(null); flush(); }
  return { config, settings, drafts, pending, error, change, finishChange, repeat, retry, reload };
}

function providerNames(config: SwarmSettings, membership: Membership) {
  const limits = config.provider_limits ?? [];
  const cells = [...config.cells, ...config.unclassified];
  const known = [...limits, ...cells].map(item => item.provider);
  const names = new Set([...known, ...(membership.configuredProviders ?? [])]);
  function offered(provider: string) {
    if (!membership.configuredProviders || membership.configuredProviders.includes(provider)) return true;
    if (limits.some(item => item.provider === provider && item.limit !== null)) return true;
    return cells.some(cell => cell.provider === provider && hasActivity(cell));
  }
  function added(provider: string) {
    if (!membership.addedProviders || membership.addedProviders.includes(provider)) return true;
    return cells.some(cell => cell.provider === provider && (cell.running ?? 0) > 0);
  }
  return [...names].filter(offered).filter(added);
}
function hasActivity(cell: { running: number | null; waiting: number | null }) {
  return (cell.running ?? 0) > 0 || (cell.waiting ?? 0) > 0;
}
function activeCount(provider: string, config: SwarmSettings, failed: boolean) {
  const cells = config.cells.filter(cell => cell.provider === provider);
  if (failed || !cells.length) return null;
  if (cells.some(cell => cell.running === null)) return null;
  const unclassified = config.unclassified.filter(item => item.provider === provider);
  return [...cells, ...unclassified].reduce((sum, cell) => sum + cell.running!, 0);
}
function limitLabel(limit: number | null) {
  if (limit === null) return "No limit";
  return `${limit} concurrent${limit === 0 ? " · paused" : ""}`;
}
type DraftState = ReturnType<typeof useLimitDrafts>;
function providerLimit(provider: string, config: SwarmSettings, drafts: Drafts) {
  const saved = config.provider_limits?.find(item => item.provider === provider)?.limit ?? null;
  const limit = Object.hasOwn(drafts, provider) ? drafts[provider]! : saved;
  const sliderMax = Math.max(32, saved ?? 0, limit ?? 0) + 1;
  return { limit, sliderMax };
}
function ProviderSlider({ provider, config, membership, draft }: { provider: string; config: SwarmSettings; membership: Membership; draft: DraftState }) {
  const { settings, drafts, finishChange, change } = draft;
  const removed = membership.addedProviders !== undefined && !membership.addedProviders.includes(provider);
  const { limit, sliderMax } = providerLimit(provider, config, drafts);
  const reported = config.cells.some(cell => cell.provider === provider);
  const active = activeCount(provider, config, settings.isError);
  return <div className={styles.provider}>
    <div className={styles.heading}><strong>{provider}{removed ? " · removed" : ""}</strong><span>{limitLabel(limit)}</span></div>
    <input type="range" aria-label={`${provider} concurrent agents`} aria-valuetext={limit === null ? "No limit" : undefined} min="0" max={sliderMax} step="1" value={limit ?? sliderMax} disabled={removed || settings.isError || !reported} onChange={event => { const value = Number(event.currentTarget.value); change(provider, value === sliderMax ? null : value); }} onPointerUp={finishChange} onKeyUp={finishChange} />
    <div className={styles.burn}><ProviderBurn provider={provider} proposedLimit={limit} active={active} /></div>
  </div>;
}
const ERROR_TEXT: Record<LimitError, string> = {
  unknown: "Update outcome unknown.", conflict: "Limits changed elsewhere. Reload to review your changes.",
  review: "Current limits reloaded. Review your slider values before retrying.", failed: "Update failed. Your changes are retained.",
};
function UpdateNotice({ draft }: { draft: DraftState }) {
  const { error, repeat, retry, reload } = draft;
  if (!error) return null;
    return <div className={styles.notice} role="alert">{ERROR_TEXT[error]}{" "}
      {error === "unknown" && <button type="button" onClick={repeat}>Retry same update</button>}
      {error === "conflict" && <button type="button" onClick={() => void reload()}>Reload limits</button>}
      {(error === "failed" || error === "review") && <button type="button" onClick={retry}>Retry changes</button>}
    </div>;
}
function ReadNotice({ draft }: { draft: DraftState }) {
  const { config, settings } = draft;
  return <>
    {!config && settings.isPending && <span role="status">Loading provider limits…</span>}
    {settings.isError && <span role="alert">Provider limits unavailable.</span>}
    {config && config.provider_limits === undefined && <span role="alert">Provider limits are unavailable on this server.</span>}
  </>;
}
function StatusHeader(membership: Membership) {
  const draft = useLimitDrafts();
  const { config, pending } = draft;
  const { addedProviders } = membership;
  return <section className={styles.status} aria-label="Swarm status">
    <ReadNotice draft={draft} />
    {config?.provider_limits && <div className={styles.providerGrid}>
      {providerNames(config, membership).map(provider => <ProviderSlider key={provider} provider={provider} config={config} membership={membership} draft={draft} />)}
    </div>}
    {addedProviders?.length === 0 && <span>No providers added. Add a provider in Settings to allow new agents.</span>}
    {pending && <span className={styles.notice} role="status">Updating limits…</span>}
    <UpdateNotice draft={draft} />
  </section>;
}
