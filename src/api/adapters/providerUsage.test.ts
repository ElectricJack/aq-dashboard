import type { Envelope, ProviderUsage, QuotaWindow } from "../wire/proposed";
import { adaptProviderUsage, atServerTime } from "./providerUsage";

const SERVER_TIME = "2026-10-31T12:00:00.000Z";

function window(overrides: Partial<QuotaWindow> = {}): QuotaWindow {
  return {
    id: "week",
    label: "Week",
    starts_at: "2026-10-27T00:00:00.000Z",
    resets_at: "2026-11-02T00:00:00.000Z",
    used_percent: 42,
    used: null,
    limit: null,
    unit: null,
    state: "known",
    observation: {
      observed_at: "2026-10-31T11:59:58.000Z",
      fresh_until: "2026-10-31T12:01:00.000Z",
      source: "collector",
      quality: "reported",
      coverage: "complete",
    },
    ...overrides,
  };
}

function envelope(data: ProviderUsage[]): Envelope<ProviderUsage[]> {
  return {
    api_version: "proposed-0",
    request_id: "req-1",
    server_time: SERVER_TIME,
    scope: { kind: "all_authorized" },
    data,
    observation: {
      observed_at: SERVER_TIME,
      fresh_until: SERVER_TIME,
      source: "aq",
      quality: "reported",
      coverage: "complete",
    },
    pending_operations: [],
    coverage: { state: "complete" },
  };
}

function provider(windows: QuotaWindow[], preferred: string | null = "week"): ProviderUsage {
  return {
    provider_id: "anthropic",
    account_ref: "acct-1",
    account_label: "Claude",
    scope: "provider_account",
    windows,
    preferred_window_id: preferred,
    availability_ref: null,
  };
}

function firstWindow(data: ProviderUsage[]) {
  const view = adaptProviderUsage(envelope(data));
  const win = view.providers[0]?.windows[0];
  if (!win) throw new Error("expected a window");
  return win;
}

test("keeps a reported used percent and its window label", () => {
  const win = firstWindow([provider([window()])]);
  expect(win).toMatchObject({ label: "Week", usedPercent: 42, state: "known", freshness: "fresh" });
});

test("treats a null used percent as unknown, never zero", () => {
  const win = firstWindow([provider([window({ used_percent: null })])]);
  expect(win.usedPercent).toBeNull();
  expect(win.state).toBe("unknown");
});

test("treats an out-of-range percent as unknown rather than clamping", () => {
  expect(firstWindow([provider([window({ used_percent: 140 })])]).state).toBe("unknown");
  expect(firstWindow([provider([window({ used_percent: -1 })])]).state).toBe("unknown");
});

test("does not derive a percent from used and limit quantities", () => {
  const win = firstWindow([provider([window({ used_percent: null, used: 50, limit: 100 })])]);
  expect(win.usedPercent).toBeNull();
});

test("marks a window stale when server time is past fresh_until, keeping observed_at", () => {
  const win = firstWindow([
    provider([
      window({
        observation: {
          observed_at: "2026-10-31T11:00:00.000Z",
          fresh_until: "2026-10-31T11:01:00.000Z",
          source: "collector",
          quality: "reported",
          coverage: "complete",
        },
      }),
    ]),
  ]);
  expect(win.freshness).toBe("stale");
  expect(win.observedAt).toBe("2026-10-31T11:00:00.000Z");
  expect(win.usedPercent).toBe(42);
});

test("reports unavailable windows without a percent", () => {
  const win = firstWindow([provider([window({ state: "unavailable", used_percent: 10 })])]);
  expect(win.state).toBe("unavailable");
  expect(win.usedPercent).toBeNull();
});

test("renders an unrecognised state enum as unsupported", () => {
  const raw = window() as unknown as Record<string, unknown>;
  raw.state = "almost_full";
  const win = firstWindow([provider([raw as unknown as QuotaWindow])]);
  expect(win.state).toBe("unsupported");
  expect(win.usedPercent).toBeNull();
});

test("keeps every window separately without a combined percent", () => {
  const view = adaptProviderUsage(
    envelope([provider([window(), window({ id: "day", label: "Day", used_percent: 90 })])]),
  );
  const p = view.providers[0];
  expect(p?.windows.map((w) => [w.label, w.usedPercent])).toEqual([
    ["Week", 42],
    ["Day", 90],
  ]);
  expect(p).not.toHaveProperty("usedPercent");
});

test("uses the server-preferred window and ignores a dangling preference", () => {
  const two = [window(), window({ id: "day", label: "Day" })];
  expect(adaptProviderUsage(envelope([provider(two, "day")])).providers[0]?.preferredWindowId).toBe(
    "day",
  );
  expect(
    adaptProviderUsage(envelope([provider(two, "missing")])).providers[0]?.preferredWindowId,
  ).toBeNull();
});

test("labels provider usage as account-scoped", () => {
  const view = adaptProviderUsage(envelope([provider([window()])]));
  expect(view.providers[0]).toMatchObject({ accountLabel: "Claude", scope: "provider_account" });
});

test("rejects an envelope whose data is not a list", () => {
  const bad = { ...envelope([]), data: {} } as unknown as Envelope<ProviderUsage[]>;
  expect(() => adaptProviderUsage(bad)).toThrow(/contract/i);
});

test("re-evaluates freshness at a later server time without a new response", () => {
  const view = adaptProviderUsage(envelope([provider([window()])]));
  const later = atServerTime(view, "2026-10-31T12:05:00.000Z");
  expect(later.serverTime).toBe("2026-10-31T12:05:00.000Z");
  expect(later.providers[0]?.windows[0]?.freshness).toBe("stale");
  expect(view.providers[0]?.windows[0]?.freshness).toBe("fresh");
});

test("keeps the observation quality and coverage of each window", () => {
  const win = firstWindow([
    provider([
      window({
        observation: {
          observed_at: SERVER_TIME,
          fresh_until: "2026-10-31T12:01:00.000Z",
          source: "collector",
          quality: "estimated",
          coverage: "partial",
        },
      }),
    ]),
  ]);
  expect(win).toMatchObject({ quality: "estimated", coverage: "partial" });
});

describe("SO-08: staleness follows the dashboard's poll interval", () => {
  const at = (seconds: number) => new Date(Date.parse("2026-11-06T09:24:36.541Z") + seconds * 1000).toISOString();
  // Live shape: AQ marks the observation fresh for only 5 s; the strip polls every 60 s.
  const live = (quality: QuotaWindow["observation"]["quality"]) => adaptProviderUsage({
    api_version: "dashboard-read-1", request_id: "r", server_time: at(0), scope: { kind: "all_authorized" },
    data: [{ provider_id: "anthropic", account_ref: "a", account_label: "a", scope: "provider_account", preferred_window_id: "week", availability_ref: null,
      windows: [window({ observation: { observed_at: at(0), fresh_until: at(5), source: "collector", quality, coverage: "complete" } })] }],
    observation: { observed_at: at(0), fresh_until: at(5), source: "aq", quality: "reported", coverage: "complete" }, pending_operations: [], coverage: { state: "complete" },
  } as Envelope<ProviderUsage[]>);
  const freshness = (result: ReturnType<typeof live>, seconds: number) => atServerTime(result, at(seconds)).providers[0]!.windows[0]!.freshness;
  test("a reading past fresh_until but within poll interval + margin is not stale", () => {
    const result = live("reported");
    expect(freshness(result, 11)).toBe("fresh"); expect(freshness(result, 52)).toBe("fresh"); expect(freshness(result, 89)).toBe("fresh");
    expect(freshness(result, 91)).toBe("stale");
  });
  test("an unknown-quality reading is not reported, never stale", () => {
    expect(freshness(live("unknown"), 600)).toBe("fresh");
  });
});

test("reset credits preserve zero, details, independent freshness and old-server unknown", () => {
  const observation = window().observation;
  const p = { ...provider([window()]), reset_credits: { state: "known" as const, available_count: 0, grants: [{ label: "Weekly", remaining_count: 1, expires_at: "2026-12-01T00:00:00Z", usable_now: false, clears: ["seven_day"] }], observation } };
  const result = adaptProviderUsage(envelope([p, provider([window()])]));
  expect(result.providers[0]?.resetCredits).toMatchObject({ state: "known", availableCount: 0, grants: [{ label: "Weekly", usableNow: false }] });
  expect(result.providers[1]?.resetCredits).toMatchObject({ state: "unknown", availableCount: null });
  const later = atServerTime(result, "2026-10-31T12:05:00Z");
  expect(later.providers[0]?.resetCredits?.freshness).toBe("stale");
  const mixed = adaptProviderUsage(envelope([{ ...p, reset_credits: { ...p.reset_credits, observation: { ...observation, observed_at: "2026-10-31T10:00:00Z", fresh_until: "2026-10-31T10:01:00Z" } } }]));
  expect(mixed.providers[0]?.resetCredits?.freshness).toBe("stale");
  expect(mixed.providers[0]?.windows[0]?.freshness).toBe("fresh");
});

test("malformed reset metadata cannot erase windows or fabricate a count", () => {
  for (const count of [-1, 1.5, 1000001, null]) {
    const raw = { ...provider([window()]), reset_credits: { state: "known", available_count: count, grants: null, observation: window().observation } };
    const view = adaptProviderUsage(envelope([raw as unknown as ProviderUsage]));
    expect(view.providers[0]?.resetCredits).toMatchObject({ state: "unknown", availableCount: null });
    expect(view.providers[0]?.windows[0]?.usedPercent).toBe(42);
  }
});


test("preserves an expired grant's reported unusable state", () => {
  const p = { ...provider([window()]), reset_credits: { state: "known" as const, available_count: 1, grants: [{ label: "Expired", remaining_count: 1, expires_at: "2026-10-01T00:00:00Z", usable_now: false, clears: [] }], observation: window().observation } };
  expect(adaptProviderUsage(envelope([p])).providers[0]?.resetCredits?.grants?.[0]).toMatchObject({ expiresAt: "2026-10-01T00:00:00Z", usableNow: false });
});
