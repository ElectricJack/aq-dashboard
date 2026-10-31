import type { Envelope, ProviderUsage, QuotaWindow } from "../wire/proposed";
import { ContractError, isStale } from "./contract";

export type QuotaState = "known" | "unknown" | "unavailable" | "unsupported";
export type Freshness = "fresh" | "stale";

export type QuotaWindowView = {
  id: string;
  label: string;
  /** 0–100 when reported; null means unknown and must never render as zero. */
  usedPercent: number | null;
  resetsAt: string | null;
  state: QuotaState;
  freshness: Freshness;
  observedAt: string;
  freshUntil: string;
  quality: QuotaWindow["observation"]["quality"];
  coverage: QuotaWindow["observation"]["coverage"];
};

export type ProviderUsageView = {
  providerId: string;
  accountRef: string;
  accountLabel: string;
  scope: "provider_account";
  windows: QuotaWindowView[];
  preferredWindowId: string | null;
};

export type ProviderUsageResult = {
  serverTime: string;
  providers: ProviderUsageView[];
  coverage: Envelope<unknown>["coverage"];
};

const KNOWN_STATES = new Set<string>(["known", "unknown", "unavailable"]);

function adaptWindow(win: QuotaWindow, serverTime: string): QuotaWindowView {
  let state: QuotaState = KNOWN_STATES.has(win.state) ? win.state : "unsupported";
  const pct = win.used_percent;
  const validPercent = typeof pct === "number" && Number.isFinite(pct) && pct >= 0 && pct <= 100;
  if (state === "known" && !validPercent) state = "unknown";
  return {
    id: win.id,
    label: win.label,
    usedPercent: state === "known" ? pct : null,
    resetsAt: win.resets_at,
    state,
    freshness: isStale(serverTime, win.observation.fresh_until) ? "stale" : "fresh",
    observedAt: win.observation.observed_at,
    freshUntil: win.observation.fresh_until,
    quality: win.observation.quality,
    coverage: win.observation.coverage,
  };
}

export function adaptProviderUsage(envelope: Envelope<ProviderUsage[]>): ProviderUsageResult {
  if (!Array.isArray(envelope.data)) throw new ContractError("provider usage data must be a list");
  return {
    serverTime: envelope.server_time,
    coverage: envelope.coverage,
    providers: envelope.data.map((p) => {
      const windows = p.windows.map((w) => adaptWindow(w, envelope.server_time));
      const preferred = windows.some((w) => w.id === p.preferred_window_id)
        ? p.preferred_window_id
        : null;
      return {
        providerId: p.provider_id,
        accountRef: p.account_ref,
        accountLabel: p.account_label,
        scope: "provider_account",
        windows,
        preferredWindowId: preferred,
      };
    }),
  };
}

/** Re-evaluates freshness at a later server-anchored time, so ages keep moving between polls. */
export function atServerTime(result: ProviderUsageResult, serverTime: string): ProviderUsageResult {
  return {
    ...result,
    serverTime,
    providers: result.providers.map((p) => ({
      ...p,
      windows: p.windows.map((w) => ({
        ...w,
        freshness: isStale(serverTime, w.freshUntil) ? "stale" : "fresh",
      })),
    })),
  };
}
