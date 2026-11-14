/** Session-only quota observations; percentages are quota points, never currency. */
export type BurnSample = { at: number; used: number; reset: string | null; active: number | null };
export type BurnEstimate = { pointsPerHour: number; projectedPointsPerHour: number | null; hoursToLimit: number | null; elapsedMinutes: number };
const HOUR = 3_600_000;
const MAX_GAP = 150_000;
const MIN_BASELINE = 5 * 60_000;

export function appendBurnSample(previous: BurnSample[], sample: BurnSample): BurnSample[] {
  if (!Number.isFinite(sample.at) || !Number.isFinite(sample.used) || sample.used < 0 || sample.used > 100) return [];
  const last = previous.at(-1);
  if (last && sample.at === last.at) return previous;
  const reset = last && (sample.at < last.at || sample.at - last.at > MAX_GAP || sample.reset !== last.reset || sample.used < last.used);
  return [...(reset ? [] : previous.filter(item => sample.at - item.at <= HOUR / 2)), sample];
}

export function estimateBurn(samples: BurnSample[], proposedLimit: number | null): BurnEstimate | null {
  const first = samples[0], last = samples.at(-1);
  if (!first || !last || last.at - first.at < MIN_BASELINE || last.used <= first.used) return null;
  const hours = (last.at - first.at) / HOUR;
  const pointsPerHour = (last.used - first.used) / hours;
  // Agent counts are snapshots. Calibrate only over an unchanged positive count;
  // changes between observations and other account activity remain uncertainty.
  const count = first.active;
  const calibrated = count !== null && count > 0 && samples.every(sample => sample.active === count);
  const projectedPointsPerHour = calibrated && proposedLimit !== null && Number.isFinite(proposedLimit) && proposedLimit >= 0
    ? pointsPerHour / count * proposedLimit : null;
  return { pointsPerHour, projectedPointsPerHour, hoursToLimit: (100 - last.used) / pointsPerHour, elapsedMinutes: hours * 60 };
}
