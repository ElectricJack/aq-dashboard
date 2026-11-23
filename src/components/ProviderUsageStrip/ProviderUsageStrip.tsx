import { useId, useState } from "react";
import type {
  ProviderUsageResult,
  ProviderUsageView,
  QuotaWindowView,
} from "../../api/adapters/providerUsage";
import { Resets } from "./ResetCredits";
import { formatAge } from "../time/relative";
export { WindowSummary, formatPercent } from "./QuotaWindow";
import { WindowSummary } from "./QuotaWindow";
import styles from "./ProviderUsageStrip.module.css";
import { configuredAccountLabel, configuredAccountStatus, configuredProviderLabel, type ConfiguredProviders } from "../../api/adapters/configuredProviders";

export type ProviderUsageState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "disabled"; reason: string }
  | { status: "configured"; data: ConfiguredProviders; stale: boolean }
  | { status: "configuration-error" }
  | { status: "ready"; data: ProviderUsageResult };

/**
 * Header summary: one entry per provider account with its preferred window. When every entry
 * is fresh, the per-entry ages collapse into one trailing label showing the oldest observation;
 * otherwise each entry keeps its own (stale) freshness. Full facts stay in ProviderUsageStrip.
 */
export function ProviderUsageSummary({ state }: { state: ProviderUsageState }) {
  if (state.status === "configured") return <ConfiguredSummary state={state} />;
  if (state.status === "configuration-error") return <>Provider configuration unavailable</>;
  if (state.status !== "ready") return <>{state.status === "loading" ? "Loading usage…" : "Usage unavailable"}</>;
  if (state.data.providers.length === 0) return <>No provider accounts reported</>;
  return <ReadySummary data={state.data} />;
}

type ConfiguredUsage = Extract<ProviderUsageState, { status: "configured" }>;

function ConfiguredSummary({ state }: { state: ConfiguredUsage }) {
  if (state.data.accounts.length === 0) return <>No providers configured</>;
    return <span className={styles.summary}>{state.data.accounts.slice(0, 2).map(account => <span className={styles.summaryEntry} key={JSON.stringify([account.provider, account.account_reference])} title={`${configuredAccountLabel(account)}: ${configuredAccountStatus(account)}; quota unavailable; startup configuration only`}>
      <span className={styles.summaryName}>{configuredProviderLabel(account)}</span><span className={styles.summaryStatus} data-stale={state.stale || undefined}>{configuredAccountStatus(account)} · quota unavailable</span>
    </span>)}{state.data.accounts.length > 2 && <span>+{state.data.accounts.length - 2}</span>}</span>;
}

function preferredWindow(provider: ProviderUsageView) {
  return provider.windows.find(window => window.id === provider.preferredWindowId);
}

function missingWindow(provider: ProviderUsageView) {
  return provider.windows.length ? "No preferred window reported" : "Usage unavailable";
}

function oldestFreshWindow(rows: { primary?: QuotaWindowView }[]) {
  const shared = rows.every(row => row.primary?.freshness === "fresh");
  const oldest = shared
    ? rows.map(row => row.primary!.observedAt).reduce((a, b) => (Date.parse(b) < Date.parse(a) ? b : a))
    : null;
  return { shared, oldest };
}

function ReadySummary({ data }: { data: ProviderUsageResult }) {
  const { serverTime } = data;
  const rows = data.providers.map(provider => ({ provider, primary: preferredWindow(provider) }));
  const { shared, oldest } = oldestFreshWindow(rows);
  return <span className={styles.summary} data-shared-freshness={shared || undefined}>
    {rows.map(({ provider, primary }) => <span key={`${provider.providerId}:${provider.accountRef}`} className={styles.summaryEntry}>
      <span className={styles.summaryName} title={`Provider: ${provider.providerId}`}>{provider.accountLabel}</span>
      {primary
        ? <WindowSummary win={primary} serverTime={serverTime} variant="strip" name={provider.accountLabel} />
        : <span className={styles.summaryStatus}>{missingWindow(provider)}</span>}
    </span>)}
    {oldest && <span className={styles.sharedFreshness} title={`Oldest provider observation: ${oldest}`}>Updated {formatAge(serverTime, oldest)}</span>}
  </span>;
}

function ProviderEntry({ provider, serverTime }: { provider: ProviderUsageView; serverTime: string }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const primary = preferredWindow(provider);
  const many = provider.windows.length > (primary ? 1 : 0);

  return (
    <div className={styles.entry}>
      <div className={styles.head}>
        <span className={styles.name} title={`Provider: ${provider.providerId}`}>{provider.accountLabel} <span className={styles.providerId}>({provider.providerId})</span></span>
        {many && (
          <button
            type="button"
            className={styles.toggle}
            aria-expanded={open}
            aria-controls={listId}
            aria-label={`${provider.accountLabel}: ${provider.windows.length} windows`}
            onClick={() => setOpen((v) => !v)}
          >
            {provider.windows.length} windows
          </button>
        )}
      </div>
      {primary ? (
        <div className={styles.window} data-testid="quota-primary">
          <WindowSummary win={primary} serverTime={serverTime} />
        </div>
      ) : (
        <span className={styles.unknown}>{missingWindow(provider)}</span>
      )}
      <Resets credits={provider.resetCredits} serverTime={serverTime} />
      {many && open && (
        <ul id={listId} className={styles.windows} aria-label={`${provider.accountLabel} usage windows`}>
          {provider.windows.map((w) => (
            <li key={w.id} className={styles.window}>
              <WindowSummary win={w} serverTime={serverTime} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ConfiguredAccounts({ state }: { state: ConfiguredUsage }) {
  return state.data.accounts.length === 0 ? <span className={styles.notice}>No providers configured</span> : <>
        {state.data.accounts.map(account => <div className={styles.entry} key={JSON.stringify([account.provider, account.account_reference])}>
          <span className={styles.name}>{configuredAccountLabel(account)}</span>
          <span className={styles.meta}>{configuredAccountStatus(account)}</span>
          <span className={styles.unknown}>Quota unavailable</span>
        </div>)}
        <span className={styles.notice}>Startup configuration only; authentication and model readiness are not checked.{state.stale && " Configuration refresh unavailable."}</span>
      </>;
}

function StripContent({ state }: { state: ProviderUsageState }) {
  switch (state.status) {
    case "configured":
      return <ConfiguredAccounts state={state} />;
    case "configuration-error":
      return <span className={styles.notice}>Provider configuration unavailable</span>;
    case "loading":
      return <span className={styles.notice}>Loading usage…</span>;
    case "error":
      return <span className={styles.notice}>Usage unavailable: AQ did not return provider usage</span>;
    case "disabled":
      return <span className={styles.notice}>Usage unavailable: {state.reason}</span>;
    case "ready":
      return state.data.providers.length === 0 ? (
          <span className={styles.notice}>No provider accounts reported</span>
        ) : (
          state.data.providers.map((p) => (
            <ProviderEntry key={`${p.providerId}:${p.accountRef}`} provider={p} serverTime={state.data.serverTime} />
          ))
        );
  }
}

/** Account-scoped provider quota. Unknown is never rendered as zero. */
export function ProviderUsageStrip({ state }: { state: ProviderUsageState }) {
  const partial = state.status === "ready" && state.data.coverage.state !== "complete";
  return (
    <section className={styles.strip} aria-label="Provider usage (account-wide)">
      <StripContent state={state} />
      {partial && <span className={styles.notice}>Some provider accounts are not reported</span>}
    </section>
  );
}
