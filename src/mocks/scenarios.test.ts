import { adaptBootstrap } from "../api/adapters/bootstrap";
import { adaptProviderUsage } from "../api/adapters/providerUsage";
import { SCENARIOS, scenario } from "./scenarios";

test("every scenario's fixtures satisfy the proposed adapters", () => {
  for (const name of SCENARIOS) {
    const { bootstrap, providerUsage } = scenario(name);
    expect(() => adaptBootstrap(bootstrap)).not.toThrow();
    if (providerUsage.kind === "ok") {
      expect(() => adaptProviderUsage(providerUsage.body)).not.toThrow();
    }
  }
});

test("default scenario has known usage for two providers", () => {
  const s = scenario("default");
  if (s.providerUsage.kind !== "ok") throw new Error("expected ok");
  const view = adaptProviderUsage(s.providerUsage.body);
  expect(view.providers.map((p) => p.accountLabel)).toEqual(["Claude", "Codex"]);
  expect(view.providers.every((p) => p.windows.every((w) => w.state === "known"))).toBe(true);
});

test("stale scenario marks every window stale", () => {
  const s = scenario("stale");
  if (s.providerUsage.kind !== "ok") throw new Error("expected ok");
  const windows = adaptProviderUsage(s.providerUsage.body).providers.flatMap((p) => p.windows);
  expect(windows.every((w) => w.freshness === "stale")).toBe(true);
});

test("unknown scenario reports no percentages", () => {
  const s = scenario("unknown");
  if (s.providerUsage.kind !== "ok") throw new Error("expected ok");
  const windows = adaptProviderUsage(s.providerUsage.body).providers.flatMap((p) => p.windows);
  expect(windows.every((w) => w.usedPercent === null)).toBe(true);
});

test("unavailable scenario disables the quota capability", () => {
  expect(adaptBootstrap(scenario("unavailable").bootstrap).capability("provider.quota").enabled).toBe(
    false,
  );
});

test("failed scenario returns a 503 error envelope for provider usage", () => {
  const s = scenario("failed");
  expect(s.providerUsage).toMatchObject({ kind: "error", status: 503, body: { retryable: true } });
});

test("unknown scenario names fall back to default", () => {
  expect(scenario("nonsense")).toBe(scenario("default"));
});
