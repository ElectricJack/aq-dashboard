/** Relative labels computed from server time, never from the local clock. */
function compact(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function diff(from: string, to: string): number | null {
  const a = Date.parse(from);
  const b = Date.parse(to);
  return Number.isNaN(a) || Number.isNaN(b) ? null : b - a;
}

export function formatUntil(serverTime: string, target: string): string {
  const ms = diff(serverTime, target);
  if (ms === null) return "unknown time";
  return ms <= 0 ? "due now" : `in ${compact(ms)}`;
}

export function formatAge(serverTime: string, observed: string): string {
  const ms = diff(observed, serverTime);
  if (ms === null) return "unknown time";
  return `${compact(Math.max(0, ms))} ago`;
}
