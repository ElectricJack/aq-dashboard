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
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
const W1 = "20000000-0000-4000-8000-000000007400", W2 = "20000000-0000-4000-8000-000000007401";
const texts = (list: HTMLElement) => within(list).getAllByRole("listitem").map(li => li.textContent);

describe("board", () => {
  const draw = (view: ReturnType<typeof adaptSwarm>, onSelect = vi.fn(), now = () => 0) => { render(<SlotBoard view={view} anchor={anchor} selected={null} onSelect={onSelect} now={now} />); return onSelect; };
  const board = (swarm: Swarm, onSelect = vi.fn(), now = () => 0) => draw(adaptSwarm(swarm, NOW), onSelect, now);
  const cell = (name: string | RegExp) => screen.getByRole("button", { name }).closest("li")!;

  const states = (worker: string) => within(screen.getByRole("list", { name: `${worker} slots` })).getAllByRole("listitem").map(li => li.dataset.state);
  const names = (worker: string) => within(screen.getByRole("list", { name: `${worker} slots` })).getAllByRole("button").map(b => b.getAttribute("aria-label")!.replace(/,.*/, ""));
  const FREE = "free";

  test("machine, then worker node, then one tile per slot in slot order: twenty slots on three workers are twenty tiles", () => {
    board(demoSwarm(NOW, true));
    // Each worker node is a group under its machine, named, with its own count.
    expect(screen.getAllByRole("list").map(list => list.getAttribute("aria-label"))).toEqual(["Local Worker 1 slots", "Local Worker 2 slots", "Local Worker 3 slots"]);
    expect(states("Local Worker 1")).toEqual(["running", "running", FREE, "running", FREE, FREE, FREE, FREE]);
    expect(states("Local Worker 2")).toEqual(["running", "starting", "running", FREE, FREE, FREE, FREE, FREE]);
    expect(states("Local Worker 3")).toEqual(["finishing", FREE, FREE, FREE]);
    expect(screen.getAllByRole("listitem")).toHaveLength(20);
    expect(names("Local Worker 1")).toEqual(["Slot 1", "Slot 2", "Slot 3 free", "Slot 4", "Slot 5 free", "Slot 6 free", "Slot 7 free", "Slot 8 free"]);
    expect(names("Local Worker 3")).toEqual(["Slot 1", "Slot 2 free", "Slot 3 free", "Slot 4 free"]);
    expect(screen.getByRole("button", { name: /^Local Worker 1/ })).toHaveTextContent(/^Local Worker 13 of 8 slots busy$/);
    expect(screen.getByRole("button", { name: /^Local Worker 3/ })).toHaveTextContent(/^Local Worker 31 of 4 slots busy$/);
    expect(within(screen.getByRole("region", { name: "Local Worker 2" })).getAllByRole("listitem")).toHaveLength(8);
    expect(screen.getByRole("button", { name: /^Fixture desktop/ })).toHaveTextContent("6 of 16 slots busy on 2 workers · CPU 74% · RAM 61%");
    expect(screen.getByRole("button", { name: /^Fixture laptop/ })).toHaveTextContent("1 of 4 slots busy on 1 worker");
  });

  test("the owner changes a worker's slot count: the board draws that many tiles", () => {
    const swarm = demoSwarm(NOW, true);
    swarm.machines[0]!.nodes[1]!.slots = { total: 5, occupied: 3, idle: 2 };
    board(swarm);
    expect(states("Local Worker 2")).toEqual(["running", "starting", "running", FREE, FREE]);
    expect(screen.getByRole("button", { name: /^Local Worker 2/ })).toHaveTextContent("3 of 5 slots busy");
    expect(screen.getByRole("button", { name: /^Fixture desktop/ })).toHaveTextContent("6 of 13 slots busy on 2 workers");
  });

  test("a busy tile is labelled with its slot, names its worker in its tooltip and name, and shows the title, project, role, level, model, effort and phase", () => {
    board(demoSwarm(NOW, true));
    const tile = screen.getByRole("button", { name: /: Fix the flaky checkout cancellation test/ });
    expect(tile).toHaveAccessibleName("Slot 2, Local Worker 1, running: Fix the flaky checkout cancellation test Fixture: storefront · developer · Standard, high Running · claude-sonnet-5-5 · high effort");
    expect(tile).toHaveTextContent(/^Fix the flaky checkout cancellation test Fixture: storefront · developer · Standard, high Running · claude-sonnet-5-5 · high effort$/);
    expect(tile).toHaveAttribute("title", "Local Worker 1: Fix the flaky checkout cancellation test, Fixture: storefront · developer · Standard, high, claude-sonnet-5-5 · high effort");
    const li = tile.closest("li")!;
    expect(li).toHaveAttribute("data-class", "standard");
    expect(li.querySelector("[data-clock]")).toHaveAttribute("data-clock", "4:03");
    // Different models carry different level colours.
    expect(cell(/: Review: migrate invoices/)).toHaveAttribute("data-class", "deep");
    expect(cell(/: Rename the cart reducer/)).toHaveAttribute("data-class", "fast");
    expect(cell(/: Add rate limiting/)).toHaveAttribute("data-state", "starting");
    expect(cell(/: Tidy the release notes template/)).toHaveAttribute("data-state", "finishing");
    // The agent in slot 4 is drawn in slot 4, after the free slot 3.
    expect(screen.getByRole("button", { name: /: Review: migrate invoices/ })).toHaveAccessibleName(/^Slot 4, Local Worker 1, running: /);
  });

  test("a free slot is a small calm tile that reads \"Slot N · free\" and names its worker", () => {
    board(demoSwarm(NOW, true));
    const free = screen.getByRole("button", { name: "Slot 3 free, Local Worker 1" });
    expect(free).toHaveTextContent(/^Slot 3 · free$/);
    expect(free.closest("li")).toHaveAttribute("data-state", "free");
    expect(free.closest("li")).not.toHaveAttribute("data-class");
    expect(free.closest("li")!.querySelector("[data-clock]")).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Slot \d+ free, / })).toHaveLength(13);
  });

  test("a worker holding for a reason, draining or offline says so on its group and in its slots instead of free", () => {
    const view = adaptSwarm(demoSwarm(NOW, true), NOW);
    const [draining, holding] = view.machines[0]!.nodes, offline = view.machines[1]!.nodes[0]!;
    draining!.service = "draining";
    holding!.holding = [{ code: "capability_expired", message: "Capability report expired", remedy: "Wait for the next report" }];
    offline.health = "offline"; offline.lastSeenAt = "2026-11-17T10:00:00.000Z";
    const onSelect = draw(view);
    expect(screen.getByRole("region", { name: "Local Worker 1" })).toHaveAttribute("data-state", "draining");
    expect(screen.getByRole("button", { name: /^Local Worker 1/ })).toHaveTextContent(/^Local Worker 1draining$/);
    // A draining worker keeps what it runs; its other slots are not offered as free.
    expect(states("Local Worker 1")).toEqual(["running", "running", "draining", "running", "draining", "draining", "draining", "draining"]);
    expect(screen.getByRole("button", { name: "Slot 3 draining, Local Worker 1" })).toHaveTextContent(/^Slot 3 · draining$/);
    expect(screen.getByRole("button", { name: /^Local Worker 2/ })).toHaveTextContent(/^Local Worker 23 of 8 slots busyholding: Capability report expired$/);
    expect(screen.getByRole("button", { name: "Slot 4 holding, Local Worker 2" }).closest("li")).toHaveAttribute("data-state", "holding");
    // The offline worker still lists its attempt in its slot; nothing of it counts as busy.
    expect(screen.getByRole("button", { name: /^Local Worker 3/ })).toHaveTextContent(/^Local Worker 3offline · last seen 2h ago$/);
    expect(states("Local Worker 3")).toEqual(["finishing", "offline", "offline", "offline"]);
    expect(screen.getByRole("button", { name: /^Fixture laptop/ })).toHaveTextContent("0 of 4 slots busy");
    expect(screen.queryByRole("button", { name: /^Slot \d+ free, / })).toBeNull();
    // Such a slot selects its worker, not a free slot.
    fireEvent.click(screen.getByRole("button", { name: "Slot 4 holding, Local Worker 2" }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "node", nodeId: W2 });
  });

  test("a worker with more agent rows than slots draws them all and says so", () => {
    const view = adaptSwarm(demoSwarm(NOW, true), NOW);
    const node = view.machines[1]!.nodes[0]!, row = node.agents[0]!;
    node.agents = [1, 2, 3, 4].map(slot => ({ ...row, sessionId: `s${slot}`, attemptId: `a${slot}`, slot, phase: "running" as const }));
    node.agents.push({ ...row, sessionId: "s5", attemptId: "a5", task: { id: "t5", title: "One too many" }, phase: "running" as const });
    delete node.agents[4]!.slot;
    node.slots = { total: 4, occupied: 5, idle: 0, held: 0 };
    draw(view);
    expect(screen.getByRole("region", { name: "Local Worker 3" })).toHaveAttribute("data-over", "true");
    expect(screen.getByRole("button", { name: /^Local Worker 3/ })).toHaveTextContent(/^Local Worker 35 of 4 slots busymore agents than slots: 5 on 4$/);
    expect(names("Local Worker 3")).toEqual(["Slot 1", "Slot 2", "Slot 3", "Slot 4", "No slot"]);
    const extra = screen.getByRole("button", { name: /^No slot, Local Worker 3, running: One too many/ });
    expect(extra.closest("li")).toHaveAttribute("data-over", "true");
    expect(extra.querySelector("[data-label]")).toHaveAttribute("data-label", "No slot");
    expect(screen.getByRole("button", { name: /^Slot 4, Local Worker 3/ }).querySelector("[data-label]")).toHaveAttribute("data-label", "Slot 4");
    // A worker within its slots is not flagged.
    expect(screen.getByRole("region", { name: "Local Worker 1" })).not.toHaveAttribute("data-over");
  });

  test("an older server's rows: a short id for a title, no role, effort or output, and a held slot is busy, never free", () => {
    board(demoSwarm(NOW));
    const tile = screen.getAllByRole("listitem").find(li => li.dataset.state === "running")!;
    expect(within(tile).getByRole("button", { name: /: Task/ })).toHaveAccessibleName("Slot 1, Local Worker 1, running: Task 20000000 Fixture: billing service · Standard, high Running · claude-sonnet-5-5");
    expect(tile).not.toHaveAttribute("data-output");
    expect(tile.querySelector("[data-output-age]")).toBeNull();
    // The attempt that is starting and the one settling hold their slots; the read names no agent for them, so each takes the lowest slot no row names.
    const held = screen.getAllByRole("button", { name: /, starting or settling: / });
    expect(held.map(b => b.getAttribute("aria-label"))).toEqual(["Slot 2, Local Worker 2, starting or settling: Starting or settling An attempt holds this slot; no agent is listed yet", "Slot 1, Local Worker 3, starting or settling: Starting or settling An attempt holds this slot; no agent is listed yet"]);
    expect(held[0]).toHaveTextContent("Starting or settling An attempt holds this slot; no agent is listed yet");
    expect(states("Local Worker 2")).toEqual(["running", "held", "running", FREE, FREE, FREE, FREE, FREE]);
    expect(screen.getAllByRole("button", { name: /^Slot \d+ free, / })).toHaveLength(13);
  });

  test("the pinned server fixture renders: an old worker that reports no slot count is one slot, showing the running agent; a worker of two slots is two tiles", () => {
    board((pinned as unknown as { data: Swarm }).data);
    expect(screen.getByRole("button", { name: /^Slot 1, profiled-fixture, running: Task 00000000 Synthetic authority fixture/ })).toBeInTheDocument();
    expect(names("profiled-fixture")).toEqual(["Slot 1"]);
    // Its worker of two slots holds: two tiles, neither offered as free.
    expect(names("local-2")).toEqual(["Slot 1 holding", "Slot 2 holding"]);
    expect(names("quiet")).toHaveLength(1);
  });

  test("the elapsed clock counts each second from the server's time", () => {
    vi.useFakeTimers();
    let mono = 0;
    board(demoSwarm(NOW, true), vi.fn(), () => mono);
    const li = cell(/: Rename the cart reducer/);
    const clock = () => li.querySelector("[data-clock]")!.getAttribute("data-clock");
    expect(clock()).toBe("0:09");
    mono = 3_000; act(() => vi.advanceTimersByTime(3_000));
    expect(clock()).toBe("0:12");
    mono = 60_000; act(() => vi.advanceTimersByTime(57_000));
    expect(clock()).toBe("1:09");
    // The starting agent has no start time, so no clock.
    expect(cell(/: Add rate limiting/).querySelector("[data-clock]")).toBeNull();
  });

  test("the activity dot follows the last output time and goes quiet when output stops", () => {
    vi.useFakeTimers();
    let mono = 0;
    board(demoSwarm(NOW, true), vi.fn(), () => mono);
    const active = cell(/: Add retry backoff/);
    expect(active).toHaveAttribute("data-output", "active");
    expect(active.querySelector("[data-output-age]")).toHaveAttribute("data-output-age", " · output 2s ago");
    // 48 seconds without output is quiet from the start.
    expect(cell(/: Review: migrate invoices/)).toHaveAttribute("data-output", "quiet");
    mono = 20_000; act(() => vi.advanceTimersByTime(20_000));
    expect(active).toHaveAttribute("data-output", "quiet");
  });

  test("the design fixture: an offline machine's worker and slots say offline, a holding one says why, three agents on a worker of three slots are three tiles", () => {
    board(SWARM_MOCKUP);
    expect(screen.getByRole("button", { name: /^laptop(?!-)/ })).toHaveTextContent(/offline · last seen/);
    expect(screen.getByRole("button", { name: /^laptop-1/ })).toHaveTextContent(/^laptop-1offline · last seen /);
    expect(states("laptop-1")).toEqual(["offline", "offline"]);
    expect(screen.getByRole("button", { name: /^studio(?!-)/ })).toHaveTextContent("holding: Capability report expired");
    expect(screen.getByRole("button", { name: /^studio-1/ })).toHaveTextContent("0 of 2 slots busyholding: Capability report expired");
    expect(screen.getByRole("button", { name: "Slot 1 holding, studio-1" }).closest("li")).toHaveAttribute("data-state", "holding");
    expect(screen.getByRole("button", { name: /^boat vm-a/ })).toHaveTextContent("booting");
    expect(states("local-1")).toEqual(["running", "running", "running"]);
    expect(states("local-2")).toEqual(["running", "free"]);
    expect(screen.getByRole("button", { name: /^desktop/ })).toHaveTextContent("4 of 5 slots busy on 2 workers");
  });

  test("a busy tile selects the agent the tree's card selects; a free tile its free slot; a worker's name its node", () => {
    const onSelect = board(demoSwarm(NOW));
    fireEvent.click(screen.getAllByRole("button", { name: /, starting or settling: / })[0]!);
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "held", nodeId: W2, index: 0 });
    fireEvent.click(screen.getAllByRole("button", { name: /: Task 2000/ })[0]!);
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "agent", sessionId: "20000000-0000-4000-8000-000000007300" });
    fireEvent.click(screen.getByRole("button", { name: /^Local Worker 1/ }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "node", nodeId: W1 });
    fireEvent.click(screen.getByRole("button", { name: "Slot 3 free, Local Worker 1" }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "free", nodeId: W1, index: 0 });
    fireEvent.click(screen.getByRole("button", { name: "Slot 5 free, Local Worker 1" }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "free", nodeId: W1, index: 1 });
    fireEvent.click(screen.getByRole("button", { name: /^Fixture desktop/ }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "machine", machineId: "desktop" });
  });
});

describe("count line", () => {
  const summary = (view: ReturnType<typeof adaptSwarm>, mode: "tree" | "board" = "board") => render(<SwarmSummary view={view} anchor={anchor} mode={mode} onMode={vi.fn()} now={() => 0} />);

  test("above the board: busy slots of all slots on how many workers, by phase, each machine's share, and nothing free", () => {
    summary(adaptSwarm(demoSwarm(NOW, true), NOW));
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("7 of 20 slots busy on 3 workers");
    expect(status).toHaveTextContent("1 starting · 5 running · 1 finishing");
    expect(status.textContent).not.toMatch(/free|machine/);
    expect(texts(screen.getByRole("list", { name: "Machines" }))).toEqual(["Fixture desktop: 6 of 16 slots busy", "Fixture laptop: 1 of 4 slots busy"]);
  });

  test("above the board: what runs right now by model, most first, with each model's level colour", () => {
    summary(adaptSwarm(demoSwarm(NOW, true), NOW));
    const models = screen.getByRole("list", { name: "Models running now" });
    expect(texts(models)).toEqual(["claude-sonnet-5-5 ×4", "claude-haiku-5-5 ×2", "claude-opus-5-5 ×1"]);
    expect(within(models).getAllByRole("listitem").map(li => li.dataset.class)).toEqual(["standard", "fast", "deep"]);
  });

  test("a worker counts toward the headline only while one of its slots is busy", () => {
    const view = adaptSwarm(demoSwarm(NOW, true), NOW);
    view.machines[1]!.nodes[0]!.agents = []; view.machines[1]!.nodes[0]!.slots = { total: 4, occupied: 0, idle: 4, held: 0 };
    view.machines[1]!.nodes[0]!.holding = [{ code: "capability_expired", message: "Capability report expired", remedy: "Wait" }]; view.machines[1]!.state = "holding";
    summary(view);
    expect(screen.getByRole("status")).toHaveTextContent("6 of 20 slots busy on 2 workers");
    expect(texts(screen.getByRole("list", { name: "Machines" }))).toEqual(["Fixture desktop: 6 of 16 slots busy", "Fixture laptop: 0 of 4 slots busy · holding"]);
    expect(texts(screen.getByRole("list", { name: "Models running now" }))).toEqual(["claude-sonnet-5-5 ×4", "claude-haiku-5-5 ×1", "claude-opus-5-5 ×1"]);
  });

  test("an older server's held slots are busy and counted as starting or settling; nothing running has no model list", () => {
    const view = adaptSwarm(demoSwarm(NOW), NOW);
    const { unmount } = summary(view);
    expect(screen.getByRole("status")).toHaveTextContent("7 of 20 slots busy on 3 workers");
    expect(screen.getByRole("status")).toHaveTextContent("5 running · 2 starting or settling");
    unmount();
    for (const m of view.machines) for (const n of m.nodes) { n.agents = []; n.slots = { ...n.slots, occupied: 0, held: 0 }; }
    summary(view);
    expect(screen.getByRole("status")).toHaveTextContent("0 of 20 slots busy");
    expect(screen.queryByRole("list", { name: "Models running now" })).toBeNull();
  });

  test("above the tree the line is the board's: the same count, shares and models; and the age of the data runs", () => {
    vi.useFakeTimers();
    let mono = 0;
    const onMode = vi.fn();
    render(<SwarmSummary view={adaptSwarm(demoSwarm(NOW), NOW)} anchor={anchor} mode="tree" onMode={onMode} now={() => mono} />);
    expect(screen.getByRole("status")).toHaveTextContent("7 of 20 slots busy on 3 workers");
    expect(screen.getByRole("status")).toHaveTextContent("5 running · 2 starting or settling");
    expect(screen.getByRole("status").textContent).not.toMatch(/free|agents running|machine/);
    expect(texts(screen.getByRole("list", { name: "Machines" }))).toEqual(["Fixture desktop: 6 of 16 slots busy", "Fixture laptop: 1 of 4 slots busy"]);
    expect(texts(screen.getByRole("list", { name: "Models running now" }))).toEqual(["claude-sonnet-5-5 ×3", "claude-haiku-5-5 ×1", "claude-opus-5-5 ×1"]);
    expect(screen.getByText("Updated 0s ago")).toBeInTheDocument();
    mono = 4_000; act(() => vi.advanceTimersByTime(4_000));
    expect(screen.getByText("Updated 4s ago")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tree" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Board" }));
    expect(onMode).toHaveBeenCalledWith("board");
  });
  test("a machine reads as holding only while one of its nodes holds in this response", () => {
    const view = adaptSwarm(demoSwarm(NOW, true), NOW);
    // The machine row still says holding from an earlier report; no node holds now.
    view.machines[0]!.state = "holding"; view.machines[0]!.holding = [{ code: "capability_expired", message: "Local Worker 2: Capability report expired", remedy: null }];
    const { unmount } = summary(view);
    expect(texts(screen.getByRole("list", { name: "Machines" }))[0]).toBe("Fixture desktop: 6 of 16 slots busy");
    unmount();
    render(<SlotBoard view={view} anchor={anchor} selected={null} onSelect={vi.fn()} now={() => 0} />);
    expect(screen.getByRole("button", { name: /^Fixture desktop/ })).toHaveTextContent(/^Fixture desktoponline6 of 16 slots busy on 2 workers/);
    expect(screen.getByRole("button", { name: /^Fixture desktop/ }).textContent).not.toMatch(/holding/);
    expect(screen.getByRole("region", { name: "Swarm board" }).textContent).not.toMatch(/holding/);
  });
  test("names an offline machine and says when the page is not updating", () => {
    render(<SwarmSummary view={adaptSwarm(SWARM_MOCKUP, SERVER_TIME)} anchor={{ serverTime: SERVER_TIME, receivedAt: 0 }} mode="board" onMode={vi.fn()} stale now={() => 0} />);
    expect(screen.getByRole("status")).toHaveTextContent("4 of 9 slots busy on 2 workers");
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
    expect(within(activity).getByRole("status")).toHaveTextContent("7 of 20 slots busy on 3 workers");
    // The swarm read gives the task id as the title; the task read gives the title, and the work read the role and effort.
    const tile = await screen.findByRole("button", { name: /: Add retry backoff to the webhook sender/ }, { timeout: 5000 });
    await waitFor(() => expect(tile).toHaveAccessibleName("Slot 1, Local Worker 1, running: Add retry backoff to the webhook sender Fixture: billing service · developer · Standard, high Running · claude-sonnet-5-5 · high effort"), { timeout: 5000 });
    await waitFor(() => expect(screen.queryByRole("button", { name: /: Task 2000/ })).toBeNull(), { timeout: 5000 });
    expect(screen.getAllByRole("button", { name: /, starting or settling: / })).toHaveLength(2);
    expect(screen.queryByRole("region", { name: "Swarm tree" })).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: /, starting or settling: / })[0]!);
    expect(await screen.findByRole("heading", { name: "Starting or settling" })).toBeInTheDocument();
    expect(router.state.location.search).toContain("select=held%3A");
    fireEvent.click(screen.getByRole("button", { name: "Tree" }));
    await waitFor(() => expect(router.state.location.search).toContain("view=tree"));
    expect(Object.entries(localStorage).filter(([key]) => key.startsWith("aq.swarm.view:")).map(([, value]) => value)).toEqual(["tree"]);
  });
});
