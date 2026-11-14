import { describe, expect, it } from "vitest";
import { appendBurnSample, estimateBurn, type BurnSample } from "./providerBurn";
const sample = (minute: number, used: number, active: number | null = 2, reset: string | null = "tomorrow"): BurnSample => ({ at: minute * 60_000, used, active, reset });
const measured = () => [0, 1, 2, 3, 4, 5].reduce<BurnSample[]>((all, minute) => appendBurnSample(all, sample(minute, 10 + minute)), []);
describe("session quota burn", () => {
  it("requires elapsed time and a measured increase, never inventing zero burn", () => {
    expect(estimateBurn([sample(0, 10), sample(1, 11)], 4)).toBeNull();
    expect(estimateBurn([sample(0, 10), sample(5, 10)], 4)).toBeNull();
  });
  it("measures account burn and conditionally extrapolates at full cap", () => {
    expect(estimateBurn(measured(), 4)).toEqual({ pointsPerHour: 60, projectedPointsPerHour: 120, hoursToLimit: 85 / 60, elapsedMinutes: 5 });
    expect(estimateBurn(measured(), 0)?.projectedPointsPerHour).toBe(0);
    expect(estimateBurn(measured(), null)?.projectedPointsPerHour).toBeNull();
  });
  it("withholds calibration for unknown, changing or zero active counts", () => {
    for (const count of [null, 0, 3]) {
      const history = measured(); history[2] = { ...history[2]!, active: count };
      expect(estimateBurn(history, 4)?.projectedPointsPerHour).toBeNull();
      expect(estimateBurn(history, 4)?.pointsPerHour).toBe(60);
    }
  });
  it("starts over at resets, quota decreases, reversed timestamps and sampling gaps", () => {
    const history = measured();
    for (const next of [sample(6, 16, 2, "next week"), sample(6, 1), sample(3, 14), sample(8, 18)]) {
      expect(appendBurnSample(history, next)).toEqual([next]);
    }
  });
  it("ignores cached duplicate observations and invalid percentages", () => {
    const history = measured();
    expect(appendBurnSample(history, sample(5, 15))).toBe(history);
    expect(appendBurnSample(history, sample(6, Number.NaN))).toEqual([]);
  });
});
