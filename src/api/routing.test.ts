import { adaptRoutingPolicy } from "./routing";

const active = { digest: "sha256:" + "a".repeat(64), structure_revision: 3, summary: ["Bug fixes: Standard, high effort."], created_at_ms: 1, took_effect_at_ms: 2, problems: [] };
const latest = { status: "failed", structure_revision: 4, error: "Could not be resolved: Art goes to the plotter.", problems: [{ path: "risk.medium", message: "there is no rule for medium risk" }],
  unresolved: ["Art goes to the plotter."], internal_task_id: "00000000-0000-4000-8000-000000000001", created_at_ms: 3, finished_at_ms: 4 };

test("adapts the routing policy state the server returns", () => {
  expect(adaptRoutingPolicy({ enabled: false, active: null, latest: null })).toEqual({ enabled: false, active: null, latest: null });
  expect(adaptRoutingPolicy({ enabled: true, active, latest })).toEqual({ enabled: true, active, latest });
  const compiling = { ...latest, status: "compiling", error: null, problems: [], unresolved: [], finished_at_ms: null };
  expect(adaptRoutingPolicy({ enabled: false, active: null, latest: compiling }).latest?.status).toBe("compiling");
});

test("refuses a response outside the contract", () => {
  expect(() => adaptRoutingPolicy({ enabled: "yes", active: null, latest: null })).toThrow("Contract violation");
  expect(() => adaptRoutingPolicy({ enabled: true, active: null, latest: { ...latest, status: "queued" } })).toThrow("Contract violation");
  expect(() => adaptRoutingPolicy({ enabled: true, active: { ...active, summary: [1] }, latest: null })).toThrow("Contract violation");
  expect(() => adaptRoutingPolicy({ enabled: true, active: { ...active, problems: [{ path: "x" }] }, latest: null })).toThrow("Contract violation");
});
