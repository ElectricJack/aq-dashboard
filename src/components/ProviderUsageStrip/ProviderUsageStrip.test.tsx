import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ProviderUsageResult, QuotaWindowView } from "../../api/adapters/providerUsage";
import { ProviderUsageStrip, ProviderUsageSummary } from "./ProviderUsageStrip";

const SERVER_TIME = "2026-10-31T12:00:00.000Z";

function win(overrides: Partial<QuotaWindowView> = {}): QuotaWindowView {
  return {
    id: "week",
    label: "Week",
    usedPercent: 42,
    resetsAt: "2026-11-02T12:00:00.000Z",
    state: "known",
    freshness: "fresh",
    observedAt: "2026-10-31T11:59:58.000Z",
    freshUntil: "2026-10-31T12:01:00.000Z",
    quality: "reported",
    coverage: "complete",
    ...overrides,
  };
}

function data(windows: QuotaWindowView[], preferred: string | null = "week"): ProviderUsageResult {
  return {
    serverTime: SERVER_TIME,
    coverage: { state: "complete" },
    providers: [
      {
        providerId: "anthropic",
        accountRef: "a",
        accountLabel: "Claude",
        scope: "provider_account",
        windows,
        preferredWindowId: preferred,
      },
    ],
  };
}

function region() {
  return screen.getByRole("region", { name: /provider usage/i });
}

test("labels the strip as account-wide usage", () => {
  render(<ProviderUsageStrip state={{ status: "ready", data: data([win()]) }} />);
  expect(region()).toHaveAccessibleName(/account-wide/i);
});

test("configured inventory shows enabled and missing-key facts without percent bars", () => {
  render(<ProviderUsageStrip state={{ status: "configured", stale: false, data: { schema_version: 1, contract: "human-provider-accounts-1", source: "startup_configuration", server_time_ms: 123, revision: 1, accounts: [
    { provider: "openai", account_reference: "team", enabled: true, provisionable: false, credential_profiles: 1 },
    { provider: "anthropic", account_reference: "other", enabled: false, provisionable: false, credential_profiles: 1 },
  ] } }} />);
  expect(region()).toHaveTextContent("OpenAI · team");
  expect(region()).toHaveTextContent("Enabled · server credentials unavailable");
  expect(region()).toHaveTextContent("Disabled");
  expect(region()).not.toHaveTextContent("% used");
  expect(region()).toHaveTextContent("authentication and model readiness are not checked");
});

test("shows provider, percent used, window name and reset", () => {
  render(<ProviderUsageStrip state={{ status: "ready", data: data([win()]) }} />);
  const r = within(region());
  expect(r.getByText("Claude")).toBeInTheDocument();
  expect(r.getByText("42% used")).toBeInTheDocument();
  expect(r.getByText(/Week/)).toBeInTheDocument();
  expect(r.getByText(/resets in 2d/)).toBeInTheDocument();
});

test("shows Usage unavailable for an unknown percent and never 0%", () => {
  render(
    <ProviderUsageStrip
      state={{ status: "ready", data: data([win({ state: "unknown", usedPercent: null })]) }}
    />,
  );
  expect(within(region()).getByText("Usage unavailable")).toBeInTheDocument();
  expect(region()).not.toHaveTextContent(/\b0%/);
});

test("labels a stale value and keeps its observation time", () => {
  render(
    <ProviderUsageStrip
      state={{
        status: "ready",
        data: data([win({ freshness: "stale", observedAt: "2026-10-31T10:12:00.000Z" })]),
      }}
    />,
  );
  const r = within(region());
  expect(r.getByText("42% used")).toBeInTheDocument();
  expect(r.getByText(/stale/i)).toHaveTextContent(/1h ago/);
});

test("shows the server-preferred window first", () => {
  render(
    <ProviderUsageStrip
      state={{
        status: "ready",
        data: data([win(), win({ id: "day", label: "Day", usedPercent: 90 })], "day"),
      }}
    />,
  );
  const primary = within(region()).getAllByTestId("quota-primary")[0];
  expect(primary).toHaveTextContent("90% used");
  expect(primary).toHaveTextContent("Day");
});

test("discloses every window separately with no combined percent", async () => {
  render(
    <ProviderUsageStrip
      state={{
        status: "ready",
        data: data([win(), win({ id: "day", label: "Day", usedPercent: 90 })]),
      }}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: /Claude: 2 windows/i }));
  const list = screen.getByRole("list", { name: /Claude usage windows/i });
  const items = within(list).getAllByRole("listitem");
  expect(items.map((i) => i.textContent)).toEqual([
    expect.stringMatching(/42% used.*Week/),
    expect.stringMatching(/90% used.*Day/),
  ]);
  expect(region()).not.toHaveTextContent(/66% used|132% used/);
});

test("loading never renders a percentage", () => {
  render(<ProviderUsageStrip state={{ status: "loading" }} />);
  expect(within(region()).getByText(/loading usage/i)).toBeInTheDocument();
  expect(region()).not.toHaveTextContent(/%/);
});

test("a failed read says usage is unavailable rather than zero", () => {
  render(<ProviderUsageStrip state={{ status: "error" }} />);
  expect(within(region()).getByText(/usage unavailable/i)).toBeInTheDocument();
  expect(region()).not.toHaveTextContent(/%/);
});

test("a disabled capability shows the server's reason", () => {
  render(
    <ProviderUsageStrip state={{ status: "disabled", reason: "No qualified provider quota source" }} />,
  );
  expect(within(region()).getByText(/No qualified provider quota source/)).toBeInTheDocument();
});

test("an empty provider list says no providers are reported", () => {
  render(<ProviderUsageStrip state={{ status: "ready", data: { ...data([]), providers: [] } }} />);
  expect(within(region()).getByText(/no provider accounts reported/i)).toBeInTheDocument();
});

test("shows the observation age of a fresh value", () => {
  render(<ProviderUsageStrip state={{ status: "ready", data: data([win()]) }} />);
  expect(within(region()).getByTestId("quota-primary")).toHaveTextContent(/updated 2s ago/);
});

test("rounds an estimated percent and labels it as estimated", () => {
  render(
    <ProviderUsageStrip
      state={{ status: "ready", data: data([win({ usedPercent: 33.3333, quality: "estimated" })]) }}
    />,
  );
  const primary = within(region()).getByTestId("quota-primary");
  expect(primary).toHaveTextContent("33% used");
  expect(primary).toHaveTextContent(/estimated/i);
});

test("never rounds a value just below the limit up to 100%", () => {
  render(<ProviderUsageStrip state={{ status: "ready", data: data([win({ usedPercent: 99.7 })]) }} />);
  expect(within(region()).getByTestId("quota-primary")).toHaveTextContent(">99% used");
});

test("labels a window with partial coverage", () => {
  render(
    <ProviderUsageStrip state={{ status: "ready", data: data([win({ coverage: "partial" })]) }} />,
  );
  expect(within(region()).getByTestId("quota-primary")).toHaveTextContent(/partial/i);
});

test("says when AQ reports only some provider accounts", () => {
  render(
    <ProviderUsageStrip
      state={{ status: "ready", data: { ...data([win()]), coverage: { state: "partial" } } }}
    />,
  );
  expect(within(region()).getByText(/some provider accounts are not reported/i)).toBeInTheDocument();
});

test('does not select an arbitrary window when the owner has no preference', () => {
 render(<ProviderUsageStrip state={{status:'ready',data:data([win(),win({id:'day',label:'Day',usedPercent:90})],null)}}/>);
 expect(within(region()).queryByTestId('quota-primary')).toBeNull();
 expect(region()).toHaveTextContent('No preferred window reported');
});
test('shows a missing reset explicitly', () => {
 render(<ProviderUsageStrip state={{status:'ready',data:data([win({resetsAt:null})])}}/>);
 expect(within(region()).getByTestId('quota-primary')).toHaveTextContent('reset unknown');
 expect(region()).toHaveTextContent('anthropic');
});

test("header summary labels each quota bar with its percent and drops the raw provider id", () => {
  const { container } = render(<ProviderUsageSummary state={{ status: "ready", data: data([win()]) }} />);
  expect(screen.getByRole("progressbar", { name: "Claude Week: 42% used" })).toHaveAttribute("aria-valuenow", "42");
  expect(container).not.toHaveTextContent("anthropic");
});

test("header summary shares one freshness label only when every entry is fresh", () => {
  const { container, rerender } = render(<ProviderUsageSummary state={{ status: "ready", data: data([win()]) }} />);
  expect(container.querySelector("[data-shared-freshness]")).not.toBeNull();
  expect(screen.getByText("Updated 2s ago")).toBeInTheDocument();
  rerender(<ProviderUsageSummary state={{ status: "ready", data: data([win({ freshness: "stale", observedAt: "2026-10-31T11:00:00.000Z" })]) }} />);
  expect(container.querySelector("[data-shared-freshness]")).toBeNull();
  expect(screen.queryByText(/^Updated/)).toBeNull();
  expect(container).toHaveTextContent("Stale, observed 1h ago");
});

test("shows known reset details and stale observation inside the account disclosure", () => {
  const result = data([win()]);
  result.providers[0]!.resetCredits = { state: "known", availableCount: 2, grants: [{ label: "Weekly reset", remainingCount: 1, expiresAt: "2026-12-01T00:00:00Z", usableNow: false, clears: ["seven_day"] }], observedAt: "2026-10-31T10:00:00Z", freshUntil: "2026-10-31T10:01:00Z", quality: "reported", freshness: "stale" };
  render(<ProviderUsageStrip state={{ status: "ready", data: result }} />);
  expect(region()).toHaveTextContent("Available resets: 2");
  expect(region()).toHaveTextContent("Weekly reset · 1 remaining");
  expect(region()).toHaveTextContent("Not usable now · Clears: weekly limit");
  expect(region()).toHaveTextContent("Stale, observed");
  expect(region().querySelector("time")).toHaveAttribute("datetime", "2026-12-01T00:00:00Z");
});

test("distinguishes known zero and absent reset metadata", () => {
  const result = data([win()]);
  result.providers[0]!.resetCredits = { state: "known", availableCount: 0, grants: null, observedAt: null, freshUntil: null, quality: "unknown", freshness: "fresh" };
  const { rerender } = render(<ProviderUsageStrip state={{ status: "ready", data: result }} />);
  expect(region()).toHaveTextContent("Available resets: 0");
  result.providers[0]!.resetCredits = undefined;
  rerender(<ProviderUsageStrip state={{ status: "ready", data: result }} />);
  expect(region()).toHaveTextContent("Available resets: Unknown");
});


test("expired grants do not claim usability and unknown limit names stay private", () => {
  const result = data([win()]);
  result.providers[0]!.resetCredits = { state: "known", availableCount: 1, grants: [{ label: "Old reset", remainingCount: 1, expiresAt: "2026-10-01T00:00:00Z", usableNow: true, clears: ["some_internal_limit"] }], observedAt: SERVER_TIME, freshUntil: SERVER_TIME, quality: "reported", freshness: "fresh" };
  render(<ProviderUsageStrip state={{ status: "ready", data: result }} />);
  expect(region()).toHaveTextContent("Expired · Clears: other limit");
  expect(region()).not.toHaveTextContent("Usable now");
  expect(region()).not.toHaveTextContent("some_internal_limit");
  expect(region()).toHaveTextContent("Available resets: 1");
});
