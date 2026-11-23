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

function check(value: unknown, issue: string): asserts value { if (!value) throw new ContractError(issue); }

function reportedTime(value: unknown): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function inRange(value: unknown, maximum: number): value is number {
  return typeof value === "number" && value >= 0 && value <= maximum;
}

function adaptWindow(win: QuotaWindow, serverTime: string): QuotaWindowView {
  const issue = 'Invalid quota window';
  check(isRecord(win), issue);
  check(typeof win.id === 'string', issue);
  check(typeof win.label === 'string', issue);
  check(isRecord(win.observation), issue);
  check(reportedTime(win.observation.observed_at), issue);
  check(reportedTime(win.observation.fresh_until), issue);
  if (win.resets_at != null) check(Number.isFinite(Date.parse(win.resets_at)), issue);
  let state: QuotaState = KNOWN_STATES.has(win.state) ? win.state : "unsupported";
  const pct = win.used_percent;
  if (state === "known" && !inRange(pct, 100)) state = "unknown";
  const reading = { observedAt: win.observation.observed_at, freshUntil: win.observation.fresh_until, quality: win.observation.quality };
  return {
    id: win.id,
    label: win.label,
    usedPercent: state === "known" ? pct! : null,
    resetsAt: win.resets_at ?? null,
    state,
    freshness: freshness(serverTime, reading),
    ...reading,
    coverage: win.observation.coverage,
  };
}

const UNKNOWN_RESETS: ResetCreditsView = { state: "unknown", availableCount: null, grants: null, freshness: "fresh", observedAt: null, freshUntil: null, quality: "unknown" };
const validCount = (value: unknown): value is number => inRange(value, 1_000_000) && Number.isSafeInteger(value);
function validDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function grantAvailability(grant: Record<string, unknown>) {
  const expiresAt = validDate(grant.expires_at) ? grant.expires_at : null;
  // An invalid supplied expiry may already have elapsed.
  const hasValidExpiry = grant.expires_at == null || expiresAt !== null;
  const usableNow = hasValidExpiry && typeof grant.usable_now === "boolean" ? grant.usable_now : null;
  return { expiresAt, usableNow };
}

function grantLabel(value: unknown): string { return typeof value === "string" ? value.trim().slice(0, 120) : ""; }

function resetGrant(grant: unknown) {
  if (!isRecord(grant)) return [];
  const label = grantLabel(grant.label);
  if (!label) return [];
  return [{
    label,
    remainingCount: validCount(grant.remaining_count) ? grant.remaining_count : null,
    ...grantAvailability(grant),
    clears: grantClears(grant.clears),
  }];
}

function grantClears(values: unknown) {
  if (!Array.isArray(values)) return [];
  return values.filter((v): v is string => typeof v === "string" && !!v.trim()).slice(0, 16).map(v => v.trim().slice(0, 80));
}

function resetState(raw: Record<string, unknown>): ResetCreditsView["state"] {
  if (raw.state === "known" && validCount(raw.available_count)) return "known";
  return raw.state === "unavailable" ? "unavailable" : "unknown";
}

function resetObservation(value: unknown): value is Record<string, unknown> & { observed_at: string; fresh_until: string } {
  return isRecord(value) && validDate(value.observed_at) && validDate(value.fresh_until);
}

function adaptResetCredits(raw: unknown, serverTime: string): ResetCreditsView {
  if (!isRecord(raw) || !resetObservation(raw.observation)) return { ...UNKNOWN_RESETS };
  const { observation } = raw, state = resetState(raw);
  const grants = state === "known" && Array.isArray(raw.grants) ? raw.grants.slice(0, 100).flatMap(resetGrant) : null;
  const quality = typeof observation.quality === "string" ? observation.quality : "unknown";
  const reading = { observedAt: observation.observed_at, freshUntil: observation.fresh_until, quality };
  return { state, availableCount: state === "known" ? raw.available_count as number : null, grants,
    freshness: freshness(serverTime, reading), ...reading };
}

function checkProvider(p: ProviderUsage) {
  const issue = 'Invalid provider account';
  check(isRecord(p), issue);
  check(p.scope === 'provider_account', issue);
  check(typeof p.provider_id === 'string', issue);
  check(typeof p.account_ref === 'string', issue);
  check(typeof p.account_label === 'string', issue);
  check(Array.isArray(p.windows), issue);
}

export function adaptProviderUsage(envelope: Envelope<ProviderUsage[]>): ProviderUsageResult {
  if (!isRecord(envelope) || !Array.isArray(envelope.data)) throw new ContractError("provider usage data must be a list");
  return {
    serverTime: envelope.server_time,
    coverage: envelope.coverage,
    providers: envelope.data.map((p) => {
      checkProvider(p);
      const windows = p.windows.map((w) => adaptWindow(w, envelope.server_time));
      const preferred = windows.find(w => w.id === p.preferred_window_id)?.id ?? null;
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

function freshness(serverTime: string, reading: Pick<ResetCreditsView, "observedAt" | "freshUntil" | "quality">): Freshness {
  const { observedAt, freshUntil, quality } = reading;
  if (!observedAt || !freshUntil) return "fresh";
  return usageStale(serverTime, observedAt, freshUntil, quality) ? "stale" : "fresh";
}

/** Re-evaluates freshness at a later server-anchored time, so ages keep moving between polls. */
export function atServerTime(result: ProviderUsageResult, serverTime: string): ProviderUsageResult {
  return {
    ...result,
    serverTime,
    providers: result.providers.map((p) => ({
      ...p,
      resetCredits: p.resetCredits && { ...p.resetCredits, freshness: freshness(serverTime, p.resetCredits) },
      windows: p.windows.map((w) => ({
        ...w,
        freshness: freshness(serverTime, w),
      })),
    })),
  };
}
