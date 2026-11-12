import bootstrapFixture from "../../contracts/proposed/bootstrap.json";
import usageFixture from "../../contracts/proposed/provider-usage.json";
import type { Bootstrap, Envelope, ErrorEnvelope, ProviderUsage } from "../api/wire/proposed";

/** Mock-only scenarios over PROPOSED fixtures; never shipped in a live build. */
export const SCENARIOS = [
  "default",
  "reset-credits",
  "reset-credits-other",
  "stale",
  "unknown",
  "unavailable",
  "failed",
  "partial",
  "empty",
  "reads-failed",
  "large",
  "actions-unavailable",
  "projects-unlisted",
  "results-media",
] as const;
export type ScenarioName = (typeof SCENARIOS)[number];

export type MockResponse<T> =
  | { kind: "ok"; body: T }
  | { kind: "error"; status: number; body: ErrorEnvelope };

export type Scenario = {
  bootstrap: Bootstrap;
  providerUsage: MockResponse<Envelope<ProviderUsage[]>>;
  /** How D04 domain reads (overview, tasks, sessions, search) behave. */
  reads: "ok" | "partial" | "empty" | "failed";
  /** Human-graph fixture size: the 10-task reference project, or 130 tasks for omitted counts. */
  graph: "standard" | "large";
  /** Whether the labelled terminal/results fixtures offer `results.media.read`. */
  media: boolean;
};

/** Capabilities the labelled terminal and results fixtures (src/mocks/terminal.ts, results.ts) serve. */
export const FIXTURE_CAPABILITIES = ["terminal.watch", "terminal.control", "results.read", "results.comment", "results.feedback"] as const;

/** Adds the fixture capabilities; media stays off unless the scenario turns it on. */
export function withFixtureCapabilities(bootstrap: Bootstrap, media: boolean): Bootstrap {
  const names: readonly string[] = [...FIXTURE_CAPABILITIES, "results.media.read"];
  return {
    ...bootstrap,
    capabilities: [
      ...bootstrap.capabilities.filter((c) => !names.includes(c.name)),
      ...FIXTURE_CAPABILITIES.map((name) => ({ name, version: "1", enabled: true })),
      media
        ? { name: "results.media.read", version: "1", enabled: true }
        : { name: "results.media.read", version: "1", enabled: false, reason: "Fixture scenario: result images are not offered" },
    ],
  };
}

/** Mock-only write/project capabilities so fixture pages render their designed controls. */
export const ACTION_CAPABILITIES = [
  "projects.read",
  "tasks.create",
  "dashboard.actions",
  "tasks.edit",
  "tasks.reprioritize",
  "tasks.comments.write",
  "tasks.cancel",
  "tasks.retry",
  "tasks.dependencies.add",
  "tasks.dependencies.remove",
  "swarm.worker.control",
  "swarm.worker.enroll",
  "swarm.availability.control",
] as const;
const proposedBootstrap = (bootstrapFixture as Envelope<Bootstrap>).data;
const withActions = (enabled: boolean): Bootstrap => ({
  ...proposedBootstrap,
  capabilities: [
    ...proposedBootstrap.capabilities.filter((c) => c.name !== "swarm.read" && !(ACTION_CAPABILITIES as readonly string[]).includes(c.name)),
    ...ACTION_CAPABILITIES.map((name) =>
      enabled || name === "projects.read"
        ? { name, version: "1", enabled: true }
        : { name, version: "1", enabled: false, reason: "Fixture scenario: actions are not offered" },
    ),
    { name: "swarm.read", version: "1", enabled: true },
  ],
});
const baseBootstrap = withActions(true);
const baseUsage = usageFixture as Envelope<ProviderUsage[]>;

function mapWindows(
  fn: (w: ProviderUsage["windows"][number]) => ProviderUsage["windows"][number],
): Envelope<ProviderUsage[]> {
  return {
    ...baseUsage,
    data: baseUsage.data.map((p) => ({ ...p, windows: p.windows.map(fn) })),
  };
}

const quotaDisabled: Bootstrap = {
  ...baseBootstrap,
  capabilities: baseBootstrap.capabilities.map((c) =>
    c.name === "provider.quota"
      ? { ...c, enabled: false, reason: "No qualified provider quota source" }
      : c,
  ),
};

/** The server declines to list projects; a URL can still select one. */
const projectsUnlisted: Bootstrap = {
  ...baseBootstrap,
  capabilities: [
    ...baseBootstrap.capabilities.filter((c) => c.name !== "projects.read"),
    { name: "projects.read", version: "1", enabled: false, reason: "Project listing is not offered by this AQ server" },
  ],
};

const defaults: Scenario = {
  bootstrap: baseBootstrap,
  providerUsage: { kind: "ok", body: baseUsage },
  reads: "ok",
  graph: "standard",
  media: false,
};

const resetFixtureAccounts: ProviderUsage[] = [
      { ...baseUsage.data[0]!, account_ref: "fixture-known", account_label: "Fixture known", reset_credits: { state: "known", available_count: 2, grants: [{ label: "Weekly reset", remaining_count: 1, expires_at: "2026-12-01T00:00:00.000Z", usable_now: false, clears: ["seven_day"] }], observation: baseUsage.data[0]!.windows[0]!.observation } },
      { ...baseUsage.data[0]!, account_ref: "fixture-zero", account_label: "Fixture zero", reset_credits: { state: "known", available_count: 0, grants: [], observation: baseUsage.data[0]!.windows[0]!.observation } },
      { ...baseUsage.data[0]!, account_ref: "fixture-unknown", account_label: "Fixture unknown" },
      { ...baseUsage.data[0]!, account_ref: "fixture-stale", account_label: "Fixture stale", reset_credits: { state: "known", available_count: 1, grants: null, observation: { ...baseUsage.data[0]!.windows[0]!.observation, observed_at: "2026-10-31T10:12:00.000Z", fresh_until: "2026-10-31T10:13:00.000Z" } } },
    ];

const built: Record<ScenarioName, Scenario> = {
  default: defaults,
  "reset-credits": { ...defaults, providerUsage: { kind: "ok", body: { ...baseUsage, data: resetFixtureAccounts.slice(0, 2) } } },
  "reset-credits-other": { ...defaults, providerUsage: { kind: "ok", body: { ...baseUsage, data: resetFixtureAccounts.slice(2) } } },
  partial: { ...defaults, reads: "partial" },
  empty: { ...defaults, reads: "empty" },
  "reads-failed": { ...defaults, reads: "failed" },
  large: { ...defaults, graph: "large" },
  "results-media": { ...defaults, media: true },
  "actions-unavailable": { ...defaults, bootstrap: withActions(false) },
  "projects-unlisted": { ...defaults, bootstrap: projectsUnlisted },
  stale: {
    ...defaults,
    providerUsage: {
      kind: "ok",
      body: mapWindows((w) => ({
        ...w,
        observation: {
          ...w.observation,
          observed_at: "2026-10-31T10:12:00.000Z",
          fresh_until: "2026-10-31T10:13:00.000Z",
        },
      })),
    },
  },
  unknown: {
    ...defaults,
    providerUsage: {
      kind: "ok",
      body: mapWindows((w) => ({ ...w, state: "unknown", used_percent: null, resets_at: null })),
    },
  },
  unavailable: {
    ...defaults,
    bootstrap: quotaDisabled,
    providerUsage: {
      kind: "ok",
      body: mapWindows((w) => ({ ...w, state: "unavailable", used_percent: null })),
    },
  },
  failed: {
    ...defaults,
    providerUsage: {
      kind: "error",
      status: 503,
      body: {
        request_id: "fixture-failed",
        code: "quota_collector_unavailable",
        message: "Provider quota collector is unavailable.",
        retryable: true,
        retry_after_ms: 30000,
      },
    },
  },
};

export function scenario(name: string | null | undefined): Scenario {
  return (SCENARIOS as readonly string[]).includes(name ?? "")
    ? built[name as ScenarioName]
    : built.default;
}
