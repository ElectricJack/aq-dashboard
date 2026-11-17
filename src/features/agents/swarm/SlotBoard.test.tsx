import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { setupServer } from "msw/node";
import { vi } from "vitest";
import { adaptSwarm } from "../../../api/adapters/swarm";
import pinned from "../../../../contracts/pinned/dashboard-read/v1/fixtures/swarm.json";
import type { Swarm } from "../../../api/wire/swarm";
import { handlersFor } from "../../../mocks/handlers";
import { SERVER_TIME } from "../../../mocks/inspectionData";
import { demoSwarm, SWARM_MOCKUP } from "../../../mocks/swarm";
import { renderApp } from "../../../test/renderApp";
import { SlotBoard, SwarmSummary } from "./SlotBoard";

const NOW = "2026-11-17T12:00:00.000Z";
const anchor = { serverTime: NOW, receivedAt: 0 };
afterEach(() => vi.useRealTimers());

describe("board", () => {
  const board = (swarm: Swarm, onSelect = vi.fn(), now = () => 0) => { render(<SlotBoard view={adaptSwarm(swarm, NOW)} anchor={anchor} selected={null} onSelect={onSelect} now={now} />); return onSelect; };

  test("a slot an attempt holds is a held tile, never a free one", () => {
    board(demoSwarm(NOW));
    const first = within(screen.getByRole("list", { name: "Local Worker 1 slots" }));
    expect(first.getAllByRole("button").filter(b => b.dataset.state === "running")).toHaveLength(5);
    expect(first.getAllByRole("button", { name: /^Starting or settling/ })).toHaveLength(1);
    expect(first.getAllByRole("button", { name: "free" })).toHaveLength(2);
    // Twenty slots on three workers, each drawn once.
    expect(screen.getAllByRole("listitem")).toHaveLength(20);
    expect(screen.getAllByRole("button", { name: /^Starting or settling/ })).toHaveLength(2);
  });

  test("an occupied slot shows title, project, role, level, model, effort and state", () => {
    board(demoSwarm(NOW, true));
    const tile = screen.getByRole("button", { name: /^Add retry backoff to the webhook sender/ });
    expect(tile).toHaveAccessibleName("Add retry backoff to the webhook sender Fixture: billing service · developer · Standard, high Running · claude-sonnet-5 · high effort");
    expect(tile).toHaveAttribute("data-state", "running");
    expect(tile.querySelector("[data-clock]")).toHaveAttribute("data-clock", "9:12");
    expect(screen.getByRole("button", { name: /^Add rate limiting/ })).toHaveAttribute("data-state", "starting");
    expect(screen.getByRole("button", { name: /^Tidy the release notes template/ })).toHaveAttribute("data-state", "finishing");
  });

  test("today's rows show a short id for a title and no role, effort or output, without inventing any", () => {
    board(demoSwarm(NOW));
    const tile = screen.getAllByRole("button").find(b => b.dataset.state === "running")!;
    expect(tile).toHaveAccessibleName("Task 20000000 Fixture: billing service · Standard, high Running · claude-sonnet-5");
    expect(tile).not.toHaveAttribute("data-output");
    expect(tile.querySelector("[data-output-age]")).toBeNull();
  });

  test("the pinned server fixture renders: its running agent, and no slots for a worker that reports none", () => {
    board((pinned as unknown as { data: Swarm }).data);
    expect(screen.getByRole("button", { name: /^Task 00000000 Synthetic authority fixture/ })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "free" })).toHaveLength(2);
  });

  test("the elapsed clock counts each second from the server's time", () => {
    vi.useFakeTimers();
    let mono = 0;
    board(demoSwarm(NOW, true), vi.fn(), () => mono);
    const tile = screen.getByRole("button", { name: /^Bump the sandbox image/ });
    const clock = () => tile.querySelector("[data-clock]")!.getAttribute("data-clock");
    expect(clock()).toBe("0:09");
    mono = 3_000; act(() => vi.advanceTimersByTime(3_000));
    expect(clock()).toBe("0:12");
    mono = 60_000; act(() => vi.advanceTimersByTime(57_000));
    expect(clock()).toBe("1:09");
    // The starting agent has no start time, so no clock.
    expect(screen.getByRole("button", { name: /^Add rate limiting/ }).querySelector("[data-clock]")).toBeNull();
  });

  test("the activity dot follows the last output time and goes quiet when output stops", () => {
    vi.useFakeTimers();
    let mono = 0;
    board(demoSwarm(NOW, true), vi.fn(), () => mono);
    const active = screen.getByRole("button", { name: /^Add retry backoff/ });
    expect(active).toHaveAttribute("data-output", "active");
    expect(active.querySelector("[data-output-age]")).toHaveAttribute("data-output-age", " · output 2s ago");
    // 48 seconds without output is quiet from the start.
    expect(screen.getByRole("button", { name: /^Review: migrate invoices/ })).toHaveAttribute("data-output", "quiet");
    mono = 20_000; act(() => vi.advanceTimersByTime(20_000));
    expect(active).toHaveAttribute("data-output", "quiet");
  });

  test("an offline machine is one line with no slots; a holding machine says why", () => {
    board(SWARM_MOCKUP);
    const laptop = screen.getByRole("button", { name: /^laptop(?!-)/ });
    expect(laptop).toHaveTextContent(/offline · last seen/);
    expect(screen.queryByRole("list", { name: "laptop-1 slots" })).toBeNull();
    expect(screen.getByRole("button", { name: /^studio(?!-)/ })).toHaveTextContent("holding: Context measurement expired");
    expect(within(screen.getByRole("list", { name: "studio-1 slots" })).getAllByRole("button", { name: "free" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: /^boat vm-a/ })).toHaveTextContent("booting");
  });

  test("a tile selects the object the tree's card selects", () => {
    const onSelect = board(demoSwarm(NOW));
    fireEvent.click(screen.getAllByRole("button", { name: /^Starting or settling/ })[0]!);
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "held", nodeId: "20000000-0000-4000-8000-000000007400", index: 0 });
    fireEvent.click(screen.getAllByRole("button").find(b => b.dataset.state === "running")!);
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "agent", sessionId: "20000000-0000-4000-8000-000000007300" });
    fireEvent.click(within(screen.getByRole("list", { name: "Local Worker 3 slots" })).getByRole("button", { name: "free" }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "free", nodeId: "20000000-0000-4000-8000-000000007402", index: 0 });
    fireEvent.click(screen.getByRole("button", { name: /^Fixture desktop/ }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "machine", machineId: "desktop" });
  });
});

describe("count line", () => {
  test("says how many agents run on how many machines, each machine's share, and how old the data is", () => {
    vi.useFakeTimers();
    let mono = 0;
    const onMode = vi.fn();
    render(<SwarmSummary view={adaptSwarm(demoSwarm(NOW), NOW)} anchor={anchor} mode="tree" onMode={onMode} now={() => mono} />);
    expect(screen.getByRole("status")).toHaveTextContent("12 agents running on 2 machines");
    expect(screen.getByRole("status")).toHaveTextContent("2 starting or settling · 6 free of 20 slots");
    const machines = within(screen.getByRole("list", { name: "Machines" })).getAllByRole("listitem").map(li => li.textContent);
    expect(machines).toEqual(["Fixture desktop: 9 running · 11/16 slots", "Fixture laptop: 3 running · 3/4 slots"]);
    expect(screen.getByText("Updated 0s ago")).toBeInTheDocument();
    mono = 4_000; act(() => vi.advanceTimersByTime(4_000));
    expect(screen.getByText("Updated 4s ago")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tree" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Board" }));
    expect(onMode).toHaveBeenCalledWith("board");
  });
  test("names an offline machine and says when the page is not updating", () => {
    render(<SwarmSummary view={adaptSwarm(SWARM_MOCKUP, SERVER_TIME)} anchor={{ serverTime: SERVER_TIME, receivedAt: 0 }} mode="board" onMode={vi.fn()} stale now={() => 0} />);
    expect(within(screen.getByRole("list", { name: "Machines" })).getByText("laptop: offline")).toBeInTheDocument();
    expect(screen.getByText("Not updating")).toBeInTheDocument();
  });
});

describe("swarm page on the demo fixture", () => {
  const server = setupServer(...handlersFor("swarm-demo"));
  beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
  beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });
  afterAll(() => server.close());

  test("the board fills task titles and ran_with from the tasks' own reads and keeps the choice of view", async () => {
    const { router } = renderApp("/agents/swarm?view=board");
    const activity = await screen.findByRole("region", { name: "Swarm activity" }, { timeout: 5000 });
    expect(within(activity).getByRole("status")).toHaveTextContent("12 agents running on 2 machines");
    // The swarm read gives the task id as the title; the task read gives the title, and the work read the role and effort.
    const tile = await screen.findByRole("button", { name: /^Add retry backoff to the webhook sender/ }, { timeout: 5000 });
    await waitFor(() => expect(tile).toHaveAccessibleName("Add retry backoff to the webhook sender Fixture: billing service · developer · Standard, high Running · claude-sonnet-5 · high effort"), { timeout: 5000 });
    await waitFor(() => expect(screen.queryByRole("button", { name: /^Task 2000/ })).toBeNull(), { timeout: 5000 });
    expect(screen.getAllByRole("button", { name: /^Starting or settling/ })).toHaveLength(2);
    expect(screen.queryByRole("region", { name: "Swarm tree" })).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: /^Starting or settling/ })[0]!);
    expect(await screen.findByRole("heading", { name: "Starting or settling" })).toBeInTheDocument();
    expect(router.state.location.search).toContain("select=held%3A");
    fireEvent.click(screen.getByRole("button", { name: "Tree" }));
    await waitFor(() => expect(router.state.location.search).toContain("view=tree"));
    expect(Object.entries(localStorage).filter(([key]) => key.startsWith("aq.swarm.view:")).map(([, value]) => value)).toEqual(["tree"]);
  });
});
