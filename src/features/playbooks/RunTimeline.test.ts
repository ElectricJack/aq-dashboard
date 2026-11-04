import type { Receipt, Run } from "../../api/adapters/playbooks";
import { humanize, timelineSteps } from "./RunTimeline";

const run = (step: string, status: string): Run => ({ id: "run-1", artifact: "sha256:a", entry: "main", step, status, outcome: null, reason: null, root: "run-1", parent: null, children: [], dependencies: {}, pendingKind: null, admittedAt: 0 });
let seq = 0;
const receipt = (step: string, outcome: string | null, kind = "command_result"): Receipt => ({ sequence: String(++seq), step, at: seq, kind, operation: null, outcome, child: null });
const brief = (r: Receipt[], x: Run) => timelineSteps(r, x).map(s => `${s.label}:${s.state}:${s.status}${s.current ? "*" : ""}`);

test("humanizes machine step and kind names", () => {
  expect(humanize("request-review")).toBe("Request review");
  expect(humanize("operation_accepted")).toBe("Operation accepted");
});
test("one node per distinct receipt step, then the current step from the run", () => {
  expect(brief([receipt("inspect-attempt", "ok"), receipt("retain-source", "ok"), receipt("retain-source", "ok", "child_completed"), receipt("request-review", null, "operation_accepted")], run("request-review", "waiting")))
    .toEqual(["Inspect attempt:completed:Completed", "Retain source:completed:Completed", "Request review:waiting:Waiting*"]);
});
test("current step without receipts is appended; failed and unknown outcomes stay honest", () => {
  expect(brief([receipt("prepare", "conflict"), receipt("probe", null), receipt("lint", "skipped")], run("merge", "running")))
    .toEqual(["Prepare:failed:Failed", "Probe:recorded:Recorded", "Lint:recorded:Skipped", "Merge:active:Running*"]);
  expect(brief([], run("publish", "failed"))).toEqual(["Publish:failed:Failed*"]);
  expect(brief([receipt("publish", "ok")], run("publish", "completed"))).toEqual(["Publish:completed:Completed*"]);
});
