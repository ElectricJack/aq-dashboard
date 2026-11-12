import { useId, useState } from "react";
import type {
  ProviderUsageResult,
  ProviderUsageView,
  QuotaWindowView,
} from "../../api/adapters/providerUsage";
import { FreshnessLabel } from "../QueryStatus/FreshnessLabel";
import { formatAge, formatUntil } from "../time/relative";
import styles from "./ProviderUsageStrip.module.css";
import { configuredAccountLabel, configuredAccountStatus, configuredProviderLabel, type ConfiguredProviders } from "../../api/adapters/configuredProviders";

export type ProviderUsageState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "disabled"; reason: string }
  | { status: "configured"; data: ConfiguredProviders; stale: boolean }
  | { status: "configuration-error" }
  | { status: "ready"; data: ProviderUsageResult };

const UNAVAILABLE_TEXT: Record<Exclude<QuotaWindowView["state"], "known">, string> = {
  unknown: "Usage unavailable",
  unavailable: "Usage unavailable",
  unsupported: "Unsupported usage state",
};

/** Display value only; never rounds a nonzero value to 0% or a sub-limit value to 100%. */
export function formatPercent(pct: number): string {
  if (pct > 0 && pct < 1) return "<1%";
  if (pct > 99 && pct < 100) return ">99%";
  return `${Math.round(pct)}%`;
}

/**
 * "full" is the disclosure presentation. "strip" is the one-row header presentation: it adds a
 * labelled progress bar and keeps freshness in its own span so a shared label can replace it.
 */
export function WindowSummary({ win, serverTime, variant = "full", name }: { win: QuotaWindowView; serverTime: string; variant?: "full" | "strip"; name?: string }) {
  const known = win.state === "known" && win.usedPercent !== null;
  const level = known && win.usedPercent! >= 80 ? "high" : "normal";
  const strip = variant === "strip";
  const used = known ? `${formatPercent(win.usedPercent!)} used` : "";
  return (
    <>
      <span className={styles.figure}>
        {known ? (
          <>
            {strip ? (
              <span
                className={styles.bar}
                data-level={level}
                data-stale={win.freshness === "stale" || undefined}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(win.usedPercent!)}
                aria-valuetext={used}
                aria-label={[name, win.label].filter(Boolean).join(" ") + `: ${used}`}
              >
                <span style={{ inlineSize: `${win.usedPercent}%` }} />
              </span>
            ) : (
              <span className={styles.bar} data-level={level} aria-hidden="true">
                <span style={{ inlineSize: `${win.usedPercent}%` }} />
              </span>
            )}
            {/* In the strip the progress bar carries the spoken value. */}
            <span className={styles.percent} data-level={level} aria-hidden={strip || undefined}>
              {used}
            </span>
            {win.quality === "estimated" && <span className={styles.qualifier}>estimated</span>}
          </>
        ) : (
          <span className={styles.unknown}>{UNAVAILABLE_TEXT[win.state as keyof typeof UNAVAILABLE_TEXT]}</span>
        )}
      </span>
      <span className={styles.meta}>
        {win.label}
        {win.coverage === "partial" && <span className={styles.qualifier}> · partial data</span>}
        {win.resetsAt ? <> · resets {formatUntil(serverTime, win.resetsAt)}</> : " · reset unknown"}
        <span className={styles.freshness}>
          {" · "}
          <FreshnessLabel serverTime={serverTime} observedAt={win.observedAt} stale={win.freshness === "stale"} />
        </span>
      </span>
    </>
  );
}

/**
 * Header summary: one entry per provider account with its preferred window. When every entry
 * is fresh, the per-entry ages collapse into one trailing label showing the oldest observation;
 * otherwise each entry keeps its own (stale) freshness. Full facts stay in ProviderUsageStrip.
 */
export function ProviderUsageSummary({ state }: { state: ProviderUsageState }) {
  if (state.status === "configured") {
    if (state.data.accounts.length === 0) return <>No providers configured</>;
    return <span className={styles.summary}>{state.data.accounts.slice(0, 2).map(account => <span className={styles.summaryEntry} key={JSON.stringify([account.provider, account.account_reference])} title={`${configuredAccountLabel(account)}: ${configuredAccountStatus(account)}; quota unavailable; startup configuration only`}>
      <span className={styles.summaryName}>{configuredProviderLabel(account)}</span><span className={styles.summaryStatus} data-stale={state.stale || undefined}>{configuredAccountStatus(account)} · quota unavailable</span>
    </span>)}{state.data.accounts.length > 2 && <span>+{state.data.accounts.length - 2}</span>}</span>;
  }
  if (state.status === "configuration-error") return <>Provider configuration unavailable</>;
  if (state.status !== "ready") return <>{state.status === "loading" ? "Loading usage…" : "Usage unavailable"}</>;
  if (state.data.providers.length === 0) return <>No provider accounts reported</>;
  const { serverTime } = state.data;
  const rows = state.data.providers.map(provider => ({ provider, primary: provider.windows.find(w => w.id === provider.preferredWindowId) }));
  const shared = rows.every(row => row.primary?.freshness === "fresh");
  const oldest = shared
    ? rows.map(row => row.primary!.observedAt).reduce((a, b) => (Date.parse(b) < Date.parse(a) ? b : a))
    : null;
  return <span className={styles.summary} data-shared-freshness={shared || undefined}>
    {rows.map(({ provider, primary }) => <span key={`${provider.providerId}:${provider.accountRef}`} className={styles.summaryEntry}>
      <span className={styles.summaryName} title={`Provider: ${provider.providerId}`}>{provider.accountLabel}</span>
      {primary
        ? <WindowSummary win={primary} serverTime={serverTime} variant="strip" name={provider.accountLabel} />
        : <span className={styles.summaryStatus}>{provider.windows.length ? "No preferred window reported" : "Usage unavailable"}</span>}
    </span>)}
    {oldest && <span className={styles.sharedFreshness} title={`Oldest provider observation: ${oldest}`}>Updated {formatAge(serverTime, oldest)}</span>}
  </span>;
}

const RESET_LIMIT_LABELS: Record<string, string> = {
  five_hour: "5-hour limit", seven_day: "weekly limit", seven_day_opus: "weekly Opus limit",
  seven_day_sonnet: "weekly Sonnet limit", seven_day_oauth_apps: "weekly OAuth apps limit",
};

function ProviderEntry({ provider, serverTime }: { provider: ProviderUsageView; serverTime: string }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const primary =
    provider.windows.find((w) => w.id === provider.preferredWindowId);
  const many = provider.windows.length > 1 || (!primary && provider.windows.length > 0);

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
        <span className={styles.unknown}>{provider.windows.length ? "No preferred window reported" : "Usage unavailable"}</span>
      )}
      <div className={styles.resets}>
        <span className={styles.name}>Available resets: {provider.resetCredits?.state === "known" ? `${provider.resetCredits.availableCount}` : provider.resetCredits?.state === "unavailable" ? "Unavailable" : "Unknown"}</span>
        {provider.resetCredits?.observedAt && <span className={styles.meta}> · <FreshnessLabel serverTime={serverTime} observedAt={provider.resetCredits.observedAt} stale={provider.resetCredits.freshness === "stale"} /></span>}
        {!provider.resetCredits?.observedAt && provider.resetCredits?.freshness === "stale" && <span className={styles.stale}> · Stale</span>}
        {provider.resetCredits?.grants && provider.resetCredits.grants.length > 0 && <ul className={styles.grants}>
          {provider.resetCredits.grants.map((grant, i) => <li key={i}>
            {grant.label}{grant.remainingCount !== null && ` · ${grant.remainingCount} remaining`}
            {grant.expiresAt && <> · expires <time dateTime={grant.expiresAt}>{new Date(grant.expiresAt).toLocaleString()}</time></>}
            {grant.expiresAt && Date.parse(grant.expiresAt) <= Date.parse(serverTime) ? " · Expired" : grant.usableNow === false ? (provider.resetCredits?.freshness === "stale" ? " · Not usable when observed" : " · Not usable now") : grant.usableNow === true ? (provider.resetCredits?.freshness === "stale" ? " · Usable when observed" : " · Usable now") : null}
            {grant.clears.length > 0 && ` · Clears: ${[...new Set(grant.clears.map(key => RESET_LIMIT_LABELS[key] ?? "other limit"))].join(", ")}`}
          </li>)}
        </ul>}
      </div>
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

/** Account-scoped provider quota. Unknown is never rendered as zero. */
export function ProviderUsageStrip({ state }: { state: ProviderUsageState }) {
  let body;
  switch (state.status) {
    case "configured":
      body = state.data.accounts.length === 0 ? <span className={styles.notice}>No providers configured</span> : <>
        {state.data.accounts.map(account => <div className={styles.entry} key={JSON.stringify([account.provider, account.account_reference])}>
          <span className={styles.name}>{configuredAccountLabel(account)}</span>
          <span className={styles.meta}>{configuredAccountStatus(account)}</span>
          <span className={styles.unknown}>Quota unavailable</span>
        </div>)}
        <span className={styles.notice}>Startup configuration only; authentication and model readiness are not checked.{state.stale && " Configuration refresh unavailable."}</span>
      </>;
      break;
    case "configuration-error":
      body = <span className={styles.notice}>Provider configuration unavailable</span>;
      break;
    case "loading":
      body = <span className={styles.notice}>Loading usage…</span>;
      break;
    case "error":
      body = <span className={styles.notice}>Usage unavailable: AQ did not return provider usage</span>;
      break;
    case "disabled":
      body = <span className={styles.notice}>Usage unavailable: {state.reason}</span>;
      break;
    case "ready":
      body =
        state.data.providers.length === 0 ? (
          <span className={styles.notice}>No provider accounts reported</span>
        ) : (
          state.data.providers.map((p) => (
            <ProviderEntry key={`${p.providerId}:${p.accountRef}`} provider={p} serverTime={state.data.serverTime} />
          ))
        );
  }
  const partial = state.status === "ready" && state.data.coverage.state !== "complete";
  return (
    <section className={styles.strip} aria-label="Provider usage (account-wide)">
      {body}
      {partial && <span className={styles.notice}>Some provider accounts are not reported</span>}
    </section>
  );
}
