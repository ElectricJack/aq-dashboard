import { observationDescription, observationReasonText, observedEnded, observedRunning, OBSERVATION_DESCRIPTION, OBSERVATION_LABEL } from "./labels";

test("each observation state has a plain label and a description", () => {
  expect(OBSERVATION_LABEL).toMatchObject({
    working: "Working", quiet: "No progress lately", stale: "No recent activity",
    awaiting: "Starting", unknown: "Not observed", ended: "Ended",
  });
  for (const state of Object.keys(OBSERVATION_LABEL) as (keyof typeof OBSERVATION_LABEL)[]) {
    expect(OBSERVATION_DESCRIPTION[state]).toMatch(/\.$/);
  }
});

test("reasons are shown for unknown, quiet and stale only", () => {
  expect(observationReasonText({ state: "unknown", reason: "no_observation_source" })).toBe("No observation source is reporting for this session");
  expect(observationReasonText({ state: "quiet", reason: "no_progress_within_evidence_window" })).toBe("No progress was seen within the evidence window");
  expect(observationReasonText({ state: "stale", reason: "no_observation_within_grace" })).toBe("Nothing was observed within the start-up grace period");
  expect(observationReasonText({ state: "working", reason: "no_observation_source" })).toBeNull();
  expect(observationReasonText({ state: "unknown", reason: null })).toBeNull();
});

test("an unrecognised reason code is humanised, not dropped", () => {
  expect(observationReasonText({ state: "quiet", reason: "disk_busy" })).toBe("Disk busy");
});

test("the description includes the reason when there is one", () => {
  expect(observationDescription({ state: "working", reason: null })).toBe("The session is being observed and is making progress.");
  expect(observationDescription({ state: "unknown", reason: "no_observation_source" })).toBe("The session is not being observed, so its process state is not known. No observation source is reporting for this session.");
});

test("running and ended cover both the current and the older vocabulary", () => {
  expect(["working", "quiet", "reported_running"].every(s => observedRunning(s as never))).toBe(true);
  expect(["awaiting", "unknown", "stale", "ended"].some(s => observedRunning(s as never))).toBe(false);
  expect(observedEnded("ended") && observedEnded("reported_stopped")).toBe(true);
  expect(observedEnded("working")).toBe(false);
});
