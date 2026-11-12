import type { Envelope } from "../wire/proposed";
import type { ProviderUsage, QuotaWindow } from "../wire/overview";
import { ContractError, isRecord, isStale } from "./contract";

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

export type ResetCreditsView = {
  state: "known" | "unknown" | "unavailable";
  availableCount: number | null;
  grants: { label: string; remainingCount: number | null; expiresAt: string | null; usableNow: boolean | null; clears: string[] }[] | null;
  freshness: Freshness;
  observedAt: string | null;
  freshUntil: string | null;
  quality: string;
};

export type ProviderUsageView = {
  providerId: string;
  accountRef: string;
  accountLabel: string;
  scope: "provider_account";
  windows: QuotaWindowView[];
  preferredWindowId: string | null;
  resetCredits?: ResetCreditsView;
};

export type ProviderUsageResult = {
  serverTime: string;
  providers: ProviderUsageView[];
  coverage: Envelope<unknown>["coverage"];
};

const KNOWN_STATES = new Set<string>(["known", "unknown", "unavailable"]);
/** Usage poll budget (docs/plans/0001 section 2); subject to server limits. */
export const USAGE_POLL_MS = 60_000;
/** Slack for a slow poll before an unrefreshed reading counts as stale. */
const USAGE_STALE_MARGIN_MS = 30_000;
/**
 * A reading is stale only once it outlives both its own fresh_until and the
 * dashboard's poll interval plus a margin (SO-08): AQ may mark an observation
 * fresh for seconds, but the strip only asks again every minute, so a short
 * fresh_until alone would read "Stale" most of the time. An `unknown`-quality
 * observation reports nothing that can age, so it is never marked stale.
 * A failed refresh still marks the retained values stale (useProviderUsage).
 */
export function usageStale(serverTime: string, observedAt: string, freshUntil: string, quality: string): boolean {
  if (quality === "unknown") return false;
  if (!isStale(serverTime, freshUntil)) return false;
  const now = Date.parse(serverTime), observed = Date.parse(observedAt);
  return Number.isNaN(observed) || now > observed + USAGE_POLL_MS + USAGE_STALE_MARGIN_MS;
}

function adaptWindow(win: QuotaWindow, serverTime: string): QuotaWindowView {
  if (!isRecord(win) || typeof win.id !== 'string' || typeof win.label !== 'string' || !isRecord(win.observation) ||
      typeof win.observation.observed_at !== 'string' || !Number.isFinite(Date.parse(win.observation.observed_at)) ||
      typeof win.observation.fresh_until !== 'string' || !Number.isFinite(Date.parse(win.observation.fresh_until)) ||
      (win.resets_at != null && !Number.isFinite(Date.parse(win.resets_at)))) throw new ContractError('Invalid quota window');
  let state: QuotaState = KNOWN_STATES.has(win.state) ? win.state : "unsupported";
  const pct = win.used_percent;
  const validPercent = typeof pct === "number" && Number.isFinite(pct) && pct >= 0 && pct <= 100;
  if (state === "known" && !validPercent) state = "unknown";
  return {
    id: win.id,
    label: win.label,
    usedPercent: state === "known" ? pct! : null,
    resetsAt: win.resets_at ?? null,
    state,
    freshness: usageStale(serverTime, win.observation.observed_at, win.observation.fresh_until, win.observation.quality) ? "stale" : "fresh",
    observedAt: win.observation.observed_at,
    freshUntil: win.observation.fresh_until,
    quality: win.observation.quality,
    coverage: win.observation.coverage,
  };
}

const UNKNOWN_RESETS: ResetCreditsView = { state: "unknown", availableCount: null, grants: null, freshness: "fresh", observedAt: null, freshUntil: null, quality: "unknown" };
const validCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000;
function validDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return month >= 1 && month <= 12 && day >= 1 && day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
}

function adaptResetCredits(raw: unknown, serverTime: string): ResetCreditsView {
  if (!isRecord(raw) || !isRecord(raw.observation) || !validDate(raw.observation.observed_at) || !validDate(raw.observation.fresh_until)) return { ...UNKNOWN_RESETS };
  const state = raw.state === "known" && validCount(raw.available_count) ? "known" : raw.state === "unavailable" ? "unavailable" : "unknown";
  const grants = state === "known" && Array.isArray(raw.grants) ? raw.grants.slice(0, 100).flatMap((grant) => {
    if (!isRecord(grant) || typeof grant.label !== "string" || !grant.label.trim()) return [];
    return [{
      label: grant.label.trim().slice(0, 120),
      remainingCount: validCount(grant.remaining_count) ? grant.remaining_count : null,
      expiresAt: validDate(grant.expires_at) ? grant.expires_at : null,
      // An invalid supplied expiry may already have elapsed; do not assert usability.
      usableNow: (grant.expires_at == null || validDate(grant.expires_at)) && typeof grant.usable_now === "boolean" ? grant.usable_now : null,
      clears: Array.isArray(grant.clears) ? grant.clears.filter((v): v is string => typeof v === "string" && !!v.trim()).slice(0, 16).map(v => v.trim().slice(0, 80)) : [],
    }];
  }) : null;
  const quality = typeof raw.observation.quality === "string" ? raw.observation.quality : "unknown";
  return { state, availableCount: state === "known" ? raw.available_count as number : null, grants,
    freshness: usageStale(serverTime, raw.observation.observed_at, raw.observation.fresh_until, quality) ? "stale" : "fresh",
    observedAt: raw.observation.observed_at, freshUntil: raw.observation.fresh_until, quality };
}

export function adaptProviderUsage(envelope: Envelope<ProviderUsage[]>): ProviderUsageResult {
  if (!isRecord(envelope) || !Array.isArray(envelope.data)) throw new ContractError("provider usage data must be a list");
  return {
    serverTime: envelope.server_time,
    coverage: envelope.coverage,
    providers: envelope.data.map((p) => {
      if (!isRecord(p) || p.scope !== 'provider_account' || typeof p.provider_id !== 'string' || typeof p.account_ref !== 'string' || typeof p.account_label !== 'string' || !Array.isArray(p.windows)) throw new ContractError('Invalid provider account');
      const windows = p.windows.map((w) => adaptWindow(w, envelope.server_time));
      const preferred = windows.some((w) => w.id === p.preferred_window_id)
        ? p.preferred_window_id ?? null
        : null;
      return {
        providerId: p.provider_id,
        accountRef: p.account_ref,
        accountLabel: p.account_label,
        scope: "provider_account",
        windows,
        preferredWindowId: preferred,
        resetCredits: adaptResetCredits(p.reset_credits, envelope.server_time),
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
      resetCredits: p.resetCredits && { ...p.resetCredits, freshness: p.resetCredits.observedAt && p.resetCredits.freshUntil && usageStale(serverTime, p.resetCredits.observedAt, p.resetCredits.freshUntil, p.resetCredits.quality) ? "stale" : "fresh" },
      windows: p.windows.map((w) => ({
        ...w,
        freshness: usageStale(serverTime, w.observedAt, w.freshUntil, w.quality) ? "stale" : "fresh",
      })),
    })),
  };
}
