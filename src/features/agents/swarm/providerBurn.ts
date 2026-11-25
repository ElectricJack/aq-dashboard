/** Session-only quota observations; percentages are quota points, never currency. */
export type BurnSample = { at: number; used: number; reset: string | null; active: number | null };
export type BurnEstimate = { pointsPerHour: number; projectedPointsPerHour: number | null; hoursToLimit: number | null; elapsedMinutes: number };
const HOUR = 3_600_000;
const MAX_GAP = 150_000;
const MIN_BASELINE = 5 * 60_000;

function validPercent(value: number) {
  return Number.isFinite(value) && value >= 0 && value <= 100;
}

function sameWindow(last: BurnSample, sample: BurnSample) {
  const elapsed = sample.at - last.at;
  const continuous = elapsed >= 0 && elapsed <= MAX_GAP;
  return continuous && sample.reset === last.reset && sample.used >= last.used;
}

function projectedRate(samples: BurnSample[], rate: number, limit: number | null) {
  if (limit === null) return null;
  if (!Number.isFinite(limit) || limit < 0) return null;
  const count = samples[0]!.active;
  if (count === null || count <= 0) return null;
  // Agent counts are snapshots. Changes between observations and other account activity remain uncertainty.
  return samples.every(sample => sample.active === count) ? rate / count * limit : null;
}

export function appendBurnSample(previous: BurnSample[], sample: BurnSample): BurnSample[] {
  if (!Number.isFinite(sample.at) || !validPercent(sample.used)) return [];
  const last = previous.at(-1);
  if (last && sample.at === last.at) return previous;
  const reset = last && !sameWindow(last, sample);
  return [...(reset ? [] : previous.filter(item => sample.at - item.at <= HOUR / 2)), sample];
}

export function estimateBurn(samples: BurnSample[], proposedLimit: number | null): BurnEstimate | null {
  const first = samples[0], last = samples.at(-1);
  if (!first || !last) return null;
  if (last.at - first.at < MIN_BASELINE || last.used <= first.used) return null;
  const hours = (last.at - first.at) / HOUR;
  const pointsPerHour = (last.used - first.used) / hours;
  const projectedPointsPerHour = projectedRate(samples, pointsPerHour, proposedLimit);
  return { pointsPerHour, projectedPointsPerHour, hoursToLimit: (100 - last.used) / pointsPerHour, elapsedMinutes: hours * 60 };
}
