import { useId, useState } from "react";
import type {
  ProviderUsageResult,
  ProviderUsageView,
  QuotaWindowView,
} from "../../api/adapters/providerUsage";
import { formatAge, formatUntil } from "../time/relative";
import styles from "./ProviderUsageStrip.module.css";

export type ProviderUsageState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "disabled"; reason: string }
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

function WindowSummary({ win, serverTime }: { win: QuotaWindowView; serverTime: string }) {
  const known = win.state === "known" && win.usedPercent !== null;
  const level = known && win.usedPercent! >= 80 ? "high" : "normal";
  return (
    <>
      <span className={styles.figure}>
        {known ? (
          <>
            <span className={styles.bar} data-level={level} aria-hidden="true">
              <span style={{ inlineSize: `${win.usedPercent}%` }} />
            </span>
            <span className={styles.percent} data-level={level}>
              {formatPercent(win.usedPercent!)} used
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
        {win.resetsAt && <> · resets {formatUntil(serverTime, win.resetsAt)}</>}
        {win.freshness === "stale" ? (
          <span className={styles.stale}> · Stale, observed {formatAge(serverTime, win.observedAt)}</span>
        ) : (
          <> · updated {formatAge(serverTime, win.observedAt)}</>
        )}
      </span>
    </>
  );
}

function ProviderEntry({ provider, serverTime }: { provider: ProviderUsageView; serverTime: string }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const primary =
    provider.windows.find((w) => w.id === provider.preferredWindowId) ?? provider.windows[0];
  const many = provider.windows.length > 1;

  return (
    <div className={styles.entry}>
      <div className={styles.head}>
        <span className={styles.name}>{provider.accountLabel}</span>
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
        <span className={styles.unknown}>Usage unavailable</span>
      )}
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
