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
import { SlotBoard, SwarmSummary, othersText } from "./SlotBoard";
import { workerTile } from "./slots";

const NOW = "2026-11-17T12:00:00.000Z";
const anchor = { serverTime: NOW, receivedAt: 0 };
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
const W1 = "20000000-0000-4000-8000-000000007400";
const texts = (list: HTMLElement) => within(list).getAllByRole("listitem").map(li => li.textContent);

describe("board", () => {
  const draw = (view: ReturnType<typeof adaptSwarm>, onSelect = vi.fn(), now = () => 0) => { render(<SlotBoard view={view} anchor={anchor} selected={null} onSelect={onSelect} now={now} />); return onSelect; };
  const board = (swarm: Swarm, onSelect = vi.fn(), now = () => 0) => draw(adaptSwarm(swarm, NOW), onSelect, now);
  const cell = (name: string | RegExp) => screen.getByRole("button", { name }).closest("li")!;

  test("a worker is one tile: nine workers are nine tiles, busy or idle, under their machines", () => {
    board(demoSwarm(NOW, true));
    const desktop = screen.getByRole("list", { name: "Fixture desktop workers" }), laptop = screen.getByRole("list", { name: "Fixture laptop workers" });
    expect(within(desktop).getAllByRole("listitem").map(li => li.dataset.state)).toEqual(["running", "running", "running", "idle", "running", "running", "idle", "starting"]);
    expect(within(laptop).getAllByRole("listitem").map(li => li.dataset.state)).toEqual(["finishing"]);
    // No tile per slot: a worker with eight interactive slots and one with none reported are each one tile.
    expect(screen.getAllByRole("listitem")).toHaveLength(9);
    expect(screen.queryByRole("button", { name: "free" })).toBeNull();
    expect(screen.getByRole("button", { name: /^Fixture desktop/ })).toHaveTextContent("6 of 8 workers busy · CPU 74% · RAM 61%");
    expect(screen.getByRole("button", { name: /^Fixture laptop/ })).toHaveTextContent("1 of 1 worker busy");
  });

  test("a busy tile shows the worker's name as given, the title, project, role, level, model, effort and phase", () => {
    board(demoSwarm(NOW, true));
    const tile = screen.getByRole("button", { name: /^Fix the flaky checkout cancellation test/ });
    expect(tile).toHaveAccessibleName("Fix the flaky checkout cancellation test Fixture: storefront · developer · Standard, high Running · claude-sonnet-5-5 · high effort");
    const li = tile.closest("li")!;
    expect(li).toHaveAttribute("data-class", "standard");
    expect(within(li).getByRole("button", { name: "Local Worker 1#3" })).toBeInTheDocument();
    expect(li.querySelector("[data-clock]")).toHaveAttribute("data-clock", "4:03");
    // Different models carry different level colours.
    expect(cell(/^Review: migrate invoices/)).toHaveAttribute("data-class", "deep");
    expect(cell(/^Rename the cart reducer/)).toHaveAttribute("data-class", "fast");
    expect(cell(/^Add rate limiting/)).toHaveAttribute("data-state", "starting");
    expect(cell(/^Tidy the release notes template/)).toHaveAttribute("data-state", "finishing");
  });

  test("an idle worker is a calm tile with its name", () => {
    board(demoSwarm(NOW, true));
    const idle = screen.getByRole("button", { name: "Local Worker 1#5 idle" });
    expect(idle.closest("li")).toHaveAttribute("data-state", "idle");
    expect(idle.closest("li")).not.toHaveAttribute("data-class");
    expect(idle.closest("li")!.querySelector("[data-clock]")).toBeNull();
  });

  test("a worker holding for a reason, draining or offline says so in its tile instead of idle", () => {
    const view = adaptSwarm(demoSwarm(NOW, true), NOW);
    const [, , , idle, , , other] = view.machines[0]!.nodes;
    idle!.holding = [{ code: "capability_expired", message: "Capability report expired", remedy: "Wait for the next report" }];
    other!.service = "draining";
    view.machines[1]!.nodes[0]!.health = "offline"; view.machines[1]!.nodes[0]!.lastSeenAt = "2026-11-17T10:00:00.000Z";
    draw(view);
    expect(screen.getByRole("button", { name: "Local Worker 1#5 holding Capability report expired" }).closest("li")).toHaveAttribute("data-state", "holding");
    expect(screen.getByRole("button", { name: "Local Worker 1#8 draining" }).closest("li")).toHaveAttribute("data-state", "draining");
    // The offline worker still lists its attempt: the tile says offline and keeps the attempt as "+1".
    const off = screen.getByRole("button", { name: "Local Worker 3 offline last seen 2h ago" }).closest("li")!;
    expect(off).toHaveAttribute("data-state", "offline");
    expect(off).toHaveTextContent("+1 more on this worker: Tidy the release notes template (finishing, claude-haiku-5-5)");
    expect(screen.queryByRole("button", { name: /idle$/ })).toBeNull();
  });

  test("a busy worker that is draining keeps its attempt and says draining beside its name", () => {
    const view = adaptSwarm(demoSwarm(NOW, true), NOW);
    view.machines[0]!.nodes[0]!.service = "draining";
    draw(view);
    const li = cell(/^Add retry backoff/);
    expect(li).toHaveAttribute("data-state", "running");
    expect(li).toHaveTextContent("Local Worker 1draining");
  });

  test("a worker holding more than one attempt shows the queued running one and the rest as +N with their names", () => {
    const view = adaptSwarm(demoSwarm(NOW, true), NOW);
    const node = view.machines[0]!.nodes[0]!, queued = node.agents[0]!;
    const stale = { ...queued, sessionId: "stale", attemptId: "stale", task: { id: "t-stale", title: "An older attempt" }, startedAt: "2026-11-17T11:00:00.000Z" };
    const starting = { ...queued, sessionId: "next", attemptId: "next", task: { id: "t-next", title: "The next attempt" }, phase: "starting" as const, startedAt: null, model: "claude-opus-5-5", ranWith: null };
    node.agents = [stale, starting, queued];
    node.slots = { ...node.slots, occupied: 4, held: 1 };
    const tile = workerTile(view.machines[0]!, node);
    expect(tile.agent).toBe(queued);
    expect(othersText(tile)).toBe("An older attempt (running, claude-sonnet-5-5)\nThe next attempt (starting, claude-opus-5-5)\n1 more starting or settling");
    draw(view);
    const li = cell(/^Add retry backoff/);
    const more = within(li).getByText("+3", { exact: false });
    expect(more).toHaveAttribute("title", othersText(tile));
    expect(more).toHaveTextContent("+3 more on this worker: An older attempt (running, claude-sonnet-5-5); The next attempt (starting, claude-opus-5-5); 1 more starting or settling");
    // Still one tile for the worker.
    expect(within(screen.getByRole("list", { name: "Fixture desktop workers" })).getAllByRole("listitem")).toHaveLength(8);
    // A worker with one attempt has no "+N".
    expect(cell(/^Fix the flaky checkout/).textContent).not.toContain("+");
  });

  test("an older server's rows: a short id for a title, no role, effort or output, and a held worker is busy, never idle", () => {
    board(demoSwarm(NOW));
    const tile = screen.getAllByRole("listitem").find(li => li.dataset.state === "running")!;
    expect(within(tile).getByRole("button", { name: /^Task/ })).toHaveAccessibleName("Task 20000000 Fixture: billing service · Standard, high Running · claude-sonnet-5-5");
    expect(tile).not.toHaveAttribute("data-output");
    expect(tile.querySelector("[data-output-age]")).toBeNull();
    // The attempt that is starting and the one settling hold their workers; the read names no agent for them.
    const held = screen.getAllByRole("button", { name: /^Starting or settling/ });
    expect(held.map(b => within(b.closest("li")!).getAllByRole("button")[0]!.textContent)).toEqual(["Local Worker 2", "Local Worker 3"]);
    expect(screen.getAllByRole("button", { name: /idle$/ })).toHaveLength(2);
  });

  test("the pinned server fixture renders: one tile for its worker, showing the running agent", () => {
    board((pinned as unknown as { data: Swarm }).data);
    expect(screen.getByRole("button", { name: /^Task 00000000 Synthetic authority fixture/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "free" })).toBeNull();
  });

  test("the elapsed clock counts each second from the server's time", () => {
    vi.useFakeTimers();
    let mono = 0;
    board(demoSwarm(NOW, true), vi.fn(), () => mono);
    const li = cell(/^Rename the cart reducer/);
    const clock = () => li.querySelector("[data-clock]")!.getAttribute("data-clock");
    expect(clock()).toBe("0:09");
    mono = 3_000; act(() => vi.advanceTimersByTime(3_000));
    expect(clock()).toBe("0:12");
    mono = 60_000; act(() => vi.advanceTimersByTime(57_000));
    expect(clock()).toBe("1:09");
    // The starting agent has no start time, so no clock.
    expect(cell(/^Add rate limiting/).querySelector("[data-clock]")).toBeNull();
  });

  test("the activity dot follows the last output time and goes quiet when output stops", () => {
    vi.useFakeTimers();
    let mono = 0;
    board(demoSwarm(NOW, true), vi.fn(), () => mono);
    const active = cell(/^Add retry backoff/);
    expect(active).toHaveAttribute("data-output", "active");
    expect(active.querySelector("[data-output-age]")).toHaveAttribute("data-output-age", " · output 2s ago");
    // 48 seconds without output is quiet from the start.
    expect(cell(/^Review: migrate invoices/)).toHaveAttribute("data-output", "quiet");
    mono = 20_000; act(() => vi.advanceTimersByTime(20_000));
    expect(active).toHaveAttribute("data-output", "quiet");
  });

  test("the design fixture: an offline machine's worker says offline, a holding one says why, three agents on one worker are one tile and +2", () => {
    board(SWARM_MOCKUP);
    expect(screen.getByRole("button", { name: /^laptop(?!-)/ })).toHaveTextContent(/offline · last seen/);
    expect(screen.getByRole("button", { name: /^laptop-1 offline last seen/ }).closest("li")).toHaveAttribute("data-state", "offline");
    expect(screen.getByRole("button", { name: /^studio(?!-)/ })).toHaveTextContent("holding: Capability report expired");
    expect(screen.getByRole("button", { name: "studio-1 holding Capability report expired" }).closest("li")).toHaveAttribute("data-state", "holding");
    expect(screen.getByRole("button", { name: /^boat vm-a/ })).toHaveTextContent("booting");
    expect(texts(screen.getByRole("list", { name: "desktop workers" }))).toHaveLength(2);
    expect(screen.getByRole("button", { name: "local-1" }).closest("li")).toHaveTextContent("+2 more on this worker");
  });

  test("a busy tile selects the agent the tree's card selects; a worker's name or an idle tile selects the worker", () => {
    const onSelect = board(demoSwarm(NOW));
    fireEvent.click(screen.getAllByRole("button", { name: /^Starting or settling/ })[0]!);
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "held", nodeId: "20000000-0000-4000-8000-000000007407", index: 0 });
    fireEvent.click(screen.getAllByRole("button", { name: /^Task 2000/ })[0]!);
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "agent", sessionId: "20000000-0000-4000-8000-000000007300" });
    fireEvent.click(screen.getByRole("button", { name: "Local Worker 1" }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "node", nodeId: W1 });
    fireEvent.click(screen.getByRole("button", { name: "Local Worker 1#5 idle" }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "node", nodeId: "20000000-0000-4000-8000-000000007403" });
    fireEvent.click(screen.getByRole("button", { name: /^Fixture desktop/ }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "machine", machineId: "desktop" });
  });
});

describe("count line", () => {
  const summary = (view: ReturnType<typeof adaptSwarm>, mode: "tree" | "board" = "board") => render(<SwarmSummary view={view} anchor={anchor} mode={mode} onMode={vi.fn()} now={() => 0} />);

  test("above the board: busy workers of all workers on how many machines, by phase, each machine's share, and no slots", () => {
    summary(adaptSwarm(demoSwarm(NOW, true), NOW));
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("7 of 9 workers busy on 2 machines");
    expect(status).toHaveTextContent("1 starting · 5 running · 1 finishing");
    expect(status.textContent).not.toMatch(/free|slot/);
    expect(texts(screen.getByRole("list", { name: "Machines" }))).toEqual(["Fixture desktop: 6 of 8 busy", "Fixture laptop: 1 of 1 busy"]);
  });

  test("above the board: what runs right now by model, most first, with each model's level colour", () => {
    summary(adaptSwarm(demoSwarm(NOW, true), NOW));
    const models = screen.getByRole("list", { name: "Models running now" });
    expect(texts(models)).toEqual(["claude-sonnet-5-5 ×4", "claude-haiku-5-5 ×2", "claude-opus-5-5 ×1"]);
    expect(within(models).getAllByRole("listitem").map(li => li.dataset.class)).toEqual(["standard", "fast", "deep"]);
  });

  test("a machine counts toward the headline only while one of its workers is busy", () => {
    const view = adaptSwarm(demoSwarm(NOW, true), NOW);
    view.machines[1]!.nodes[0]!.agents = []; view.machines[1]!.nodes[0]!.slots = { total: 4, occupied: 0, idle: 4, held: 0 };
    view.machines[1]!.nodes[0]!.holding = [{ code: "capability_expired", message: "Capability report expired", remedy: "Wait" }]; view.machines[1]!.state = "holding";
    summary(view);
    expect(screen.getByRole("status")).toHaveTextContent("6 of 9 workers busy on 1 machine");
    expect(texts(screen.getByRole("list", { name: "Machines" }))).toEqual(["Fixture desktop: 6 of 8 busy", "Fixture laptop: 0 of 1 busy · holding"]);
    expect(texts(screen.getByRole("list", { name: "Models running now" }))).toEqual(["claude-sonnet-5-5 ×4", "claude-haiku-5-5 ×1", "claude-opus-5-5 ×1"]);
  });

  test("an older server's held workers are busy and counted as starting or settling; nothing running has no model list", () => {
    const view = adaptSwarm(demoSwarm(NOW), NOW);
    const { unmount } = summary(view);
    expect(screen.getByRole("status")).toHaveTextContent("7 of 9 workers busy on 2 machines");
    expect(screen.getByRole("status")).toHaveTextContent("5 running · 2 starting or settling");
    unmount();
    for (const m of view.machines) for (const n of m.nodes) { n.agents = []; n.slots = { ...n.slots, occupied: 0, held: 0 }; }
    summary(view);
    expect(screen.getByRole("status")).toHaveTextContent("0 of 9 workers busy");
    expect(screen.queryByRole("list", { name: "Models running now" })).toBeNull();
  });

  test("above the tree the line still counts agents and slots, and the age of the data runs", () => {
    vi.useFakeTimers();
    let mono = 0;
    const onMode = vi.fn();
    render(<SwarmSummary view={adaptSwarm(demoSwarm(NOW), NOW)} anchor={anchor} mode="tree" onMode={onMode} now={() => mono} />);
    expect(screen.getByRole("status")).toHaveTextContent("5 agents running on 1 machine");
    expect(screen.getByRole("status")).toHaveTextContent("2 starting or settling · 17 free");
    expect(texts(screen.getByRole("list", { name: "Machines" }))).toEqual(["Fixture desktop: 5 running · 6 busy", "Fixture laptop: 0 running · 1/4 slots"]);
    expect(screen.queryByRole("list", { name: "Models running now" })).toBeNull();
    expect(screen.getByText("Updated 0s ago")).toBeInTheDocument();
    mono = 4_000; act(() => vi.advanceTimersByTime(4_000));
    expect(screen.getByText("Updated 4s ago")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tree" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Board" }));
    expect(onMode).toHaveBeenCalledWith("board");
  });
  test("names an offline machine and says when the page is not updating", () => {
    render(<SwarmSummary view={adaptSwarm(SWARM_MOCKUP, SERVER_TIME)} anchor={{ serverTime: SERVER_TIME, receivedAt: 0 }} mode="board" onMode={vi.fn()} stale now={() => 0} />);
    expect(screen.getByRole("status")).toHaveTextContent("2 of 4 workers busy on 1 machine");
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
    expect(within(activity).getByRole("status")).toHaveTextContent("7 of 9 workers busy on 2 machines");
    // The swarm read gives the task id as the title; the task read gives the title, and the work read the role and effort.
    const tile = await screen.findByRole("button", { name: /^Add retry backoff to the webhook sender/ }, { timeout: 5000 });
    await waitFor(() => expect(tile).toHaveAccessibleName("Add retry backoff to the webhook sender Fixture: billing service · developer · Standard, high Running · claude-sonnet-5-5 · high effort"), { timeout: 5000 });
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
