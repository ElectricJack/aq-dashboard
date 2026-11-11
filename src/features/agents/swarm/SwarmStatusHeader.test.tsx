import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { ApiError } from "../../../api/client";
import { SwarmStatusHeader } from "./SwarmStatusHeader";

const mock = vi.hoisted(() => ({ configured: undefined as undefined | { accounts: { provider: string; enabled: boolean; provisionable: boolean }[] }, mutate: vi.fn(), refetch: vi.fn(), settings: { revision: "1", catalog_revision: "2", provider_limits: [{ provider: "openai", limit: null }, { provider: "anthropic", limit: 48 }], cells: [{ provider: "openai", running: 1, waiting: 2 }, { provider: "anthropic", running: 2, waiting: 0 }, { provider: "unused", running: 0, waiting: 0 }], unclassified: [] } }));
vi.mock("../../../app/session", () => ({ useSession: () => ({ queryContext: { principalId: "test" }, bootstrap: { capability: () => ({ enabled: false }) } }) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: mock.configured, isError: false }) }));
vi.mock("../../../api/swarmSettings", () => ({ useSwarmSettings: () => ({ data: mock.settings, isError: false, isPending: false, refetch: mock.refetch }), useUpdateSwarmLimits: () => ({ mutate: mock.mutate, isPending: false }) }));
vi.mock("./ProviderBurn", () => ({ ProviderBurn: () => null }));
function open() { render(<MemoryRouter><SwarmStatusHeader /></MemoryRouter>); fireEvent.click(screen.getByRole("button", { name: /show details/i })); }
beforeEach(() => { localStorage.clear(); mock.configured = undefined; mock.mutate.mockReset(); });

test("shows provider caps, preserves unlimited, and applies only on request", () => {
  open();
  expect(screen.getByText("3 active")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Intelligence settings" })).toHaveAttribute("href", "/settings?tab=intelligence");
  expect(screen.getByRole("checkbox", { name: "openai unlimited" })).toBeChecked();
  const slider = screen.getByRole("slider", { name: "anthropic concurrent agents" });
  expect(slider).toHaveAttribute("max", "48");
  fireEvent.change(slider, { target: { value: "0" } });
  expect(screen.getByText(/0 concurrent · paused · draft/)).toBeInTheDocument();
  expect(mock.mutate).not.toHaveBeenCalled();
  const row = slider.closest("div[class*=provider]")!;
  fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "Apply" }));
  expect(mock.mutate.mock.calls[0]![0]).toMatchObject({ expected_revision: "1", expected_catalog_revision: "2", provider: { provider: "anthropic", limit: 0 } });
});

test("unknown outcome retries exactly the same operation", () => {
  mock.mutate.mockImplementationOnce((_request, callbacks) => callbacks.onError(new ApiError("transport", "network", { effectUnknown: true })));
  open();
  fireEvent.click(screen.getByRole("checkbox", { name: "openai unlimited" }));
  const input = screen.getByRole("spinbutton", { name: "openai limit" });
  fireEvent.change(input, { target: { value: "5" } });
  const row = input.closest("div[class*=provider]")!;
  fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "Apply" }));
  fireEvent.click(screen.getByRole("button", { name: "Retry same update" }));
  expect(mock.mutate.mock.calls[1]![0]).toEqual(mock.mutate.mock.calls[0]![0]);
});

test("dragging an unlimited slider creates a finite draft", () => {
  open();
  const slider = screen.getByRole("slider", { name: "openai concurrent agents" });
  expect(slider).toBeEnabled();
  expect(slider).toHaveAttribute("aria-valuetext", "Unlimited");
  fireEvent.change(slider, { target: { value: "7" } });
  expect(screen.getByRole("spinbutton", { name: "openai limit" })).toHaveValue(7);
  expect(screen.getByRole("checkbox", { name: "openai unlimited" })).not.toBeChecked();
  expect(mock.mutate).not.toHaveBeenCalled();
});

test("configured providers are preferred while saved limits and activity remain visible", () => {
  mock.configured = { accounts: [{ provider: "openai", enabled: true, provisionable: true }] };
  open();
  expect(screen.getByRole("slider", { name: "openai concurrent agents" })).toBeInTheDocument();
  expect(screen.getByRole("slider", { name: "anthropic concurrent agents" })).toBeInTheDocument();
  expect(screen.queryByRole("slider", { name: "unused concurrent agents" })).not.toBeInTheDocument();
});
