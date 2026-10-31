import bootstrapFixture from "../../contracts/proposed/bootstrap.json";
import usageFixture from "../../contracts/proposed/provider-usage.json";
import type { Bootstrap, Envelope, ErrorEnvelope, ProviderUsage } from "../api/wire/proposed";

/** Mock-only scenarios over PROPOSED fixtures; never shipped in a live build. */
export const SCENARIOS = ["default", "stale", "unknown", "unavailable", "failed"] as const;
export type ScenarioName = (typeof SCENARIOS)[number];

export type MockResponse<T> =
  | { kind: "ok"; body: T }
  | { kind: "error"; status: number; body: ErrorEnvelope };

export type Scenario = {
  bootstrap: Bootstrap;
  providerUsage: MockResponse<Envelope<ProviderUsage[]>>;
};

const baseBootstrap = (bootstrapFixture as Envelope<Bootstrap>).data;
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

const built: Record<ScenarioName, Scenario> = {
  default: { bootstrap: baseBootstrap, providerUsage: { kind: "ok", body: baseUsage } },
  stale: {
    bootstrap: baseBootstrap,
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
    bootstrap: baseBootstrap,
    providerUsage: {
      kind: "ok",
      body: mapWindows((w) => ({ ...w, state: "unknown", used_percent: null, resets_at: null })),
    },
  },
  unavailable: {
    bootstrap: quotaDisabled,
    providerUsage: {
      kind: "ok",
      body: mapWindows((w) => ({ ...w, state: "unavailable", used_percent: null })),
    },
  },
  failed: {
    bootstrap: baseBootstrap,
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
