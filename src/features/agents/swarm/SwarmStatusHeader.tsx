import { useEffect, useRef, useState } from "react";
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
  const configured = useQuery({
    queryKey: queryKey(queryContext, "configured-provider-accounts", { contract: "human-provider-accounts-1" }),
    queryFn: async ({ signal }) => adaptConfiguredProviders(await apiGet<unknown>("/api/human/provider-accounts", AbortSignal.any([signal, AbortSignal.timeout(15_000)]))),
    enabled: bootstrap.capability("providers.configured.read").enabled, retry: false, refetchInterval: 60_000,
  });
  const providers = configured.isError ? undefined : configured.data?.accounts.filter(account => account.enabled).map(account => account.provider);
  return <StatusHeader key={queryContext.principalId} configuredProviders={providers} />;
}

function StatusHeader({ configuredProviders }: { configuredProviders?: string[] }) {
  const settings = useSwarmSettings();
  const mutation = useUpdateSwarmLimits();
  const config = settings.isError && isProtectedReadFailure(settings.error) ? undefined : settings.data;
  const [drafts, setDrafts] = useState<Drafts>({});
  const draftsRef = useRef<Drafts>({});
  const base = useRef<SwarmSettings | undefined>(config);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<"unknown" | "conflict" | "failed" | "review" | null>(null);
  const errorRef = useRef<typeof error>(null);
  const uncertain = useRef<UpdateSwarmLimits | null>(null);
  const updateError = (value: typeof error) => { errorRef.current = value; setError(value); };
  const updateDrafts = (value: Drafts) => { draftsRef.current = value; setDrafts(value); };
  useEffect(() => { if (!busy.current && !Object.keys(draftsRef.current).length && !errorRef.current && config && (!base.current || BigInt(config.revision) >= BigInt(base.current.revision))) base.current = config; }, [config]);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function send(request: UpdateSwarmLimits) {
    busy.current = true; setPending(true); updateError(null);
    try {
      const result = await mutation.mutateAsync(request);
      base.current = result; uncertain.current = null;
      const provider = request.provider!.provider;
      const next = { ...draftsRef.current };
      if (next[provider] === request.provider!.limit) delete next[provider];
      updateDrafts(next);
    } catch (cause) {
      if ((cause instanceof ApiError && (cause.effectUnknown || cause.kind === "contract" || (cause.status !== undefined && cause.status >= 500))) || cause instanceof ContractError) {
        uncertain.current = request; updateError("unknown");
      } else if (cause instanceof ApiError && cause.status === 409) updateError("conflict");
      else updateError("failed");
    } finally {
      busy.current = false; setPending(false);
      if (!errorRef.current && Object.keys(draftsRef.current).length) timer.current = setTimeout(flush, 350);
    }
  }
  function flush() {
    if (busy.current || errorRef.current || !base.current || settings.isError) return;
    const entry = Object.entries(draftsRef.current)[0];
    if (!entry) return;
    void send({ operation_id: crypto.randomUUID(), expected_revision: base.current.revision, expected_catalog_revision: base.current.catalog_revision, provider: { provider: entry[0], limit: entry[1] } });
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
  const cells = config?.cells ?? [], unclassified = config?.unclassified ?? [];
  const providers = [...new Set([...(config?.provider_limits ?? []).map(item => item.provider), ...cells.map(cell => cell.provider), ...unclassified.map(item => item.provider), ...(configuredProviders ?? [])])].filter(provider =>
    configuredProviders === undefined || configuredProviders.includes(provider) || config?.provider_limits?.some(item => item.provider === provider && item.limit !== null) ||
    cells.some(cell => cell.provider === provider && ((cell.running ?? 0) > 0 || (cell.waiting ?? 0) > 0)) || unclassified.some(item => item.provider === provider && (item.running > 0 || item.waiting > 0))
  );
  return <section className={styles.status} aria-label="Swarm status">
    {!config && settings.isPending && <span role="status">Loading provider limits…</span>}
    {settings.isError && <span role="alert">Provider limits unavailable.</span>}
    {config && config.provider_limits === undefined && <span role="alert">Provider limits are unavailable on this server.</span>}
    {config?.provider_limits && <div className={styles.providerGrid}>
      {providers.map(provider => {
        const saved = config.provider_limits?.find(item => item.provider === provider)?.limit ?? null;
        const limit = Object.hasOwn(drafts, provider) ? drafts[provider]! : saved;
        const sliderMax = Math.max(32, saved ?? 0, limit ?? 0) + 1;
        const matches = cells.filter(cell => cell.provider === provider);
        const active = !settings.isError && matches.length && matches.every(cell => cell.running !== null) ? matches.reduce((sum, cell) => sum + cell.running!, 0) + unclassified.filter(item => item.provider === provider).reduce((sum, item) => sum + item.running, 0) : null;
        return <div className={styles.provider} key={provider}>
          <div className={styles.heading}><strong>{provider}</strong><span>{limit === null ? "No limit" : `${limit} concurrent${limit === 0 ? " · paused" : ""}`}</span></div>
          <input type="range" aria-label={`${provider} concurrent agents`} aria-valuetext={limit === null ? "No limit" : undefined} min="0" max={sliderMax} step="1" value={limit ?? sliderMax} disabled={settings.isError || !matches.length} onChange={event => { const value = Number(event.currentTarget.value); change(provider, value === sliderMax ? null : value); }} onPointerUp={() => { clearTimeout(timer.current); flush(); }} onKeyUp={() => { clearTimeout(timer.current); flush(); }} />
          <div className={styles.burn}><ProviderBurn provider={provider} proposedLimit={limit} active={active} /></div>
        </div>;
      })}
    </div>}
    {pending && <span className={styles.notice} role="status">Updating limits…</span>}
    {error && <div className={styles.notice} role="alert">{error === "unknown" ? "Update outcome unknown." : error === "conflict" ? "Limits changed elsewhere. Reload to review your changes." : error === "review" ? "Current limits reloaded. Review your slider values before retrying." : "Update failed. Your changes are retained."}{" "}
      {error === "unknown" && <button type="button" onClick={() => { if (uncertain.current) void send(uncertain.current); }}>Retry same update</button>}
      {error === "conflict" && <button type="button" onClick={() => void reload()}>Reload limits</button>}
      {(error === "failed" || error === "review") && <button type="button" onClick={() => { updateError(null); flush(); }}>Retry changes</button>}
    </div>}
  </section>;
}
