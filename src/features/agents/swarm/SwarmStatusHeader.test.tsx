import { act, fireEvent, render, screen } from "@testing-library/react";
import { ApiError } from "../../../api/client";
import { SwarmStatusHeader } from "./SwarmStatusHeader";

const mock = vi.hoisted(() => ({ configured: undefined as undefined | { accounts: { provider: string; enabled: boolean }[] }, mutateAsync: vi.fn(), refetch: vi.fn(), settings: { revision: "1", catalog_revision: "2", provider_limits: [{ provider: "openai", limit: null }, { provider: "anthropic", limit: 48 }], cells: [{ provider: "openai", running: 1, waiting: 2 }, { provider: "anthropic", running: 2, waiting: 0 }, { provider: "unused", running: 0, waiting: 0 }], unclassified: [] } }));
vi.mock("../../../app/session", () => ({ useSession: () => ({ queryContext: { principalId: "test" }, bootstrap: { capability: () => ({ enabled: false }) } }) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: mock.configured, isError: false }) }));
vi.mock("../../../api/swarmSettings", () => ({ useSwarmSettings: () => ({ data: mock.settings, isError: false, isPending: false, refetch: mock.refetch }), useUpdateSwarmLimits: () => ({ mutateAsync: mock.mutateAsync }) }));
vi.mock("./ProviderBurn", () => ({ ProviderBurn: () => null }));
beforeEach(() => { vi.useFakeTimers(); mock.configured = undefined; mock.mutateAsync.mockReset(); });
afterEach(() => vi.useRealTimers());

test("unlimited is the last detent and slider edits are debounced", async () => {
  mock.mutateAsync.mockResolvedValue({ ...mock.settings, revision: "2" });
  render(<SwarmStatusHeader />);
  const slider = screen.getByRole("slider", { name: "openai concurrent agents" });
  expect(slider).toHaveAttribute("aria-valuetext", "No limit");
  expect(slider).toHaveValue("33");
  fireEvent.change(slider, { target: { value: "5" } });
  fireEvent.change(slider, { target: { value: "0" } });
  expect(mock.mutateAsync).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(350); });
  expect(mock.mutateAsync).toHaveBeenCalledTimes(1);
  expect(mock.mutateAsync.mock.calls[0]![0]).toMatchObject({ expected_revision: "1", provider: { provider: "openai", limit: 0 } });
});

test("unknown outcome retries the exact operation", async () => {
  mock.mutateAsync.mockRejectedValueOnce(new ApiError("transport", "network", { effectUnknown: true })).mockResolvedValueOnce({ ...mock.settings, revision: "2" });
  render(<SwarmStatusHeader />);
  fireEvent.change(screen.getByRole("slider", { name: "openai concurrent agents" }), { target: { value: "5" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(350); });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Retry same update" })); });
  expect(mock.mutateAsync.mock.calls[1]![0]).toEqual(mock.mutateAsync.mock.calls[0]![0]);
});

test("configured providers are preferred while saved limits and activity remain visible", () => {
  mock.configured = { accounts: [{ provider: "openai", enabled: true }] };
  render(<SwarmStatusHeader />);
  expect(screen.getByRole("slider", { name: "openai concurrent agents" })).toBeInTheDocument();
  expect(screen.getByRole("slider", { name: "anthropic concurrent agents" })).toBeInTheDocument();
  expect(screen.queryByRole("slider", { name: "unused concurrent agents" })).not.toBeInTheDocument();
});

test("serializes providers and sends the latest pending value with the confirmed revision", async () => {
  let complete!: (value: unknown) => void;
  mock.mutateAsync.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; })).mockResolvedValueOnce({ ...mock.settings, revision: "3" });
  render(<SwarmStatusHeader />);
  const first = screen.getByRole("slider", { name: "openai concurrent agents" });
  const second = screen.getByRole("slider", { name: "anthropic concurrent agents" });
  fireEvent.change(first, { target: { value: "5" } });
  fireEvent.pointerUp(first);
  expect(mock.mutateAsync).toHaveBeenCalledTimes(1);
  fireEvent.change(second, { target: { value: "12" } });
  fireEvent.change(second, { target: { value: "13" } });
  fireEvent.pointerUp(second);
  expect(mock.mutateAsync).toHaveBeenCalledTimes(1);
  await act(async () => { complete({ ...mock.settings, revision: "2" }); });
  await act(async () => { await vi.advanceTimersByTimeAsync(350); });
  expect(mock.mutateAsync).toHaveBeenCalledTimes(2);
  expect(mock.mutateAsync.mock.calls[1]![0]).toMatchObject({ expected_revision: "2", provider: { provider: "anthropic", limit: 13 } });
});
