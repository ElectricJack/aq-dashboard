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

  test("a node is one tile, called a slot: nine nodes are nine slots, busy or idle, under their machines", () => {
    board(demoSwarm(NOW, true));
    const desktop = screen.getByRole("list", { name: "Fixture desktop slots" }), laptop = screen.getByRole("list", { name: "Fixture laptop slots" });
    expect(within(desktop).getAllByRole("listitem").map(li => li.dataset.state)).toEqual(["running", "running", "running", "idle", "running", "running", "idle", "starting"]);
    expect(within(laptop).getAllByRole("listitem").map(li => li.dataset.state)).toEqual(["finishing"]);
    // No tile per slot: a worker with eight interactive slots and one with none reported are each one tile.
    expect(screen.getAllByRole("listitem")).toHaveLength(9);
    expect(screen.queryByRole("button", { name: "free" })).toBeNull();
    expect(screen.getByRole("button", { name: /^Fixture desktop/ })).toHaveTextContent("6 of 8 slots busy · CPU 74% · RAM 61%");
    expect(screen.getByRole("button", { name: /^Fixture laptop/ })).toHaveTextContent("1 of 1 slot busy");
  });

  test("a busy tile is labelled with its slot, keeps the node's name as given in its tooltip and name, and shows the title, project, role, level, model, effort and phase", () => {
    board(demoSwarm(NOW, true));
    const tile = screen.getByRole("button", { name: /: Fix the flaky checkout cancellation test/ });
    expect(tile).toHaveAccessibleName("Slot 2, Local Worker 1#3, running: Fix the flaky checkout cancellation test Fixture: storefront · developer · Standard, high Running · claude-sonnet-5-5 · high effort");
    expect(tile).toHaveTextContent("Fix the flaky checkout cancellation test Fixture: storefront · developer · Standard, high Running · claude-sonnet-5-5 · high effort");
    expect(tile).toHaveAttribute("title", "Local Worker 1#3: Fix the flaky checkout cancellation test, Fixture: storefront · developer · Standard, high, claude-sonnet-5-5 · high effort");
    const li = tile.closest("li")!;
    expect(li).toHaveAttribute("data-class", "standard");
    const name = within(li).getByRole("button", { name: "Slot 2, Local Worker 1#3" });
    expect(name).toHaveTextContent(/^Slot 2$/);
    expect(name).toHaveAttribute("title", "Local Worker 1#3");
    // Slots are numbered from one under each machine, in the order drawn.
    expect(screen.getAllByRole("listitem").map(item => within(item).getAllByRole("button")[0]!.textContent!.replace(/ · .*/, ""))).toEqual(["Slot 1", "Slot 2", "Slot 3", "Slot 4", "Slot 5", "Slot 6", "Slot 7", "Slot 8", "Slot 1"]);
    expect(li.querySelector("[data-clock]")).toHaveAttribute("data-clock", "4:03");
    // Different models carry different level colours.
    expect(cell(/: Review: migrate invoices/)).toHaveAttribute("data-class", "deep");
    expect(cell(/: Rename the cart reducer/)).toHaveAttribute("data-class", "fast");
    expect(cell(/: Add rate limiting/)).toHaveAttribute("data-state", "starting");
    expect(cell(/: Tidy the release notes template/)).toHaveAttribute("data-state", "finishing");
  });

  test("an idle slot is a calm tile that reads \"Slot N · idle\" and keeps its node's name", () => {
    board(demoSwarm(NOW, true));
    const idle = screen.getByRole("button", { name: "Slot 4 idle, Local Worker 1#5" });
    expect(idle).toHaveTextContent(/^Slot 4 · idle$/);
    expect(idle).toHaveAttribute("title", "Local Worker 1#5");
    expect(idle.closest("li")).toHaveAttribute("data-state", "idle");
    expect(idle.closest("li")).not.toHaveAttribute("data-class");
    expect(idle.closest("li")!.querySelector("[data-clock]")).toBeNull();
  });

  test("a slot holding for a reason, draining or offline says so in its tile instead of idle", () => {
    const view = adaptSwarm(demoSwarm(NOW, true), NOW);
    const [, , , idle, , , other] = view.machines[0]!.nodes;
    idle!.holding = [{ code: "capability_expired", message: "Capability report expired", remedy: "Wait for the next report" }];
    other!.service = "draining";
    view.machines[1]!.nodes[0]!.health = "offline"; view.machines[1]!.nodes[0]!.lastSeenAt = "2026-11-17T10:00:00.000Z";
    draw(view);
    expect(screen.getByRole("button", { name: "Slot 4 holding Capability report expired, Local Worker 1#5" }).closest("li")).toHaveAttribute("data-state", "holding");
    expect(screen.getByRole("button", { name: /^Slot 4 /})).toHaveTextContent("Slot 4 · holding Capability report expired");
    expect(screen.getByRole("button", { name: "Slot 7 draining, Local Worker 1#8" }).closest("li")).toHaveAttribute("data-state", "draining");
    // The offline slot still lists its attempt: the tile says offline and keeps the attempt as "+1".
    const off = screen.getByRole("button", { name: "Slot 1 offline last seen 2h ago, Local Worker 3" }).closest("li")!;
    expect(off).toHaveAttribute("data-state", "offline");
    expect(off).toHaveTextContent("+1 more on this slot: Tidy the release notes template (finishing, claude-haiku-5-5)");
    expect(screen.queryByRole("button", { name: /^Slot \d+ idle, / })).toBeNull();
  });

  test("a busy slot whose worker is draining keeps its attempt and says draining beside its label", () => {
    const view = adaptSwarm(demoSwarm(NOW, true), NOW);
    view.machines[0]!.nodes[0]!.service = "draining";
    draw(view);
    const li = cell(/: Add retry backoff/);
    expect(li).toHaveAttribute("data-state", "running");
    expect(li).toHaveTextContent("Slot 1draining");
  });

  test("a slot holding more than one attempt shows the queued running one and the rest as +N with their names", () => {
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
    const li = cell(/: Add retry backoff/);
    const more = within(li).getByText("+3", { exact: false });
    expect(more).toHaveAttribute("title", othersText(tile));
    expect(more).toHaveTextContent("+3 more on this slot: An older attempt (running, claude-sonnet-5-5); The next attempt (starting, claude-opus-5-5); 1 more starting or settling");
    // Still one tile for the node.
    expect(within(screen.getByRole("list", { name: "Fixture desktop slots" })).getAllByRole("listitem")).toHaveLength(8);
    // A slot with one attempt has no "+N".
    expect(cell(/: Fix the flaky checkout/).textContent).not.toContain("+");
  });

  test("an older server's rows: a short id for a title, no role, effort or output, and a held slot is busy, never idle", () => {
    board(demoSwarm(NOW));
    const tile = screen.getAllByRole("listitem").find(li => li.dataset.state === "running")!;
    expect(within(tile).getByRole("button", { name: /: Task/ })).toHaveAccessibleName("Slot 1, Local Worker 1, running: Task 20000000 Fixture: billing service · Standard, high Running · claude-sonnet-5-5");
    expect(tile).not.toHaveAttribute("data-output");
    expect(tile.querySelector("[data-output-age]")).toBeNull();
    // The attempt that is starting and the one settling hold their slots; the read names no agent for them.
    const held = screen.getAllByRole("button", { name: /, starting or settling: / });
    expect(held.map(b => b.getAttribute("aria-label"))).toEqual(["Slot 8, Local Worker 2, starting or settling: Starting or settling An attempt holds this slot; no agent is listed yet", "Slot 1, Local Worker 3, starting or settling: Starting or settling An attempt holds this slot; no agent is listed yet"]);
    expect(held.map(b => within(b.closest("li")!).getAllByRole("button")[0]!.textContent)).toEqual(["Slot 8", "Slot 1"]);
    expect(held[0]).toHaveTextContent("Starting or settling An attempt holds this slot; no agent is listed yet");
    expect(screen.getAllByRole("button", { name: /^Slot \d+ idle, / })).toHaveLength(2);
  });

  test("the pinned server fixture renders: one tile for its node, showing the running agent", () => {
    board((pinned as unknown as { data: Swarm }).data);
    expect(screen.getByRole("button", { name: /^Slot 2, profiled-fixture, running: Task 00000000 Synthetic authority fixture/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "free" })).toBeNull();
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

  test("the design fixture: an offline machine's slot says offline, a holding one says why, three agents on one node are one tile and +2", () => {
    board(SWARM_MOCKUP);
    expect(screen.getByRole("button", { name: /^laptop(?!-)/ })).toHaveTextContent(/offline · last seen/);
    expect(screen.getByRole("button", { name: /^Slot 1 offline last seen .*, laptop-1$/ }).closest("li")).toHaveAttribute("data-state", "offline");
    expect(screen.getByRole("button", { name: /^studio(?!-)/ })).toHaveTextContent("holding: Capability report expired");
    expect(screen.getByRole("button", { name: "Slot 1 holding Capability report expired, studio-1" }).closest("li")).toHaveAttribute("data-state", "holding");
    expect(screen.getByRole("button", { name: /^boat vm-a/ })).toHaveTextContent("booting");
    expect(texts(screen.getByRole("list", { name: "desktop slots" }))).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Slot 1, local-1" }).closest("li")).toHaveTextContent("+2 more on this slot");
  });

  test("a busy tile selects the agent the tree's card selects; a slot's label or an idle tile selects its node", () => {
    const onSelect = board(demoSwarm(NOW));
    fireEvent.click(screen.getAllByRole("button", { name: /, starting or settling: / })[0]!);
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "held", nodeId: "20000000-0000-4000-8000-000000007407", index: 0 });
    fireEvent.click(screen.getAllByRole("button", { name: /: Task 2000/ })[0]!);
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "agent", sessionId: "20000000-0000-4000-8000-000000007300" });
    fireEvent.click(screen.getByRole("button", { name: "Slot 1, Local Worker 1" }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "node", nodeId: W1 });
    fireEvent.click(screen.getByRole("button", { name: "Slot 4 idle, Local Worker 1#5" }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "node", nodeId: "20000000-0000-4000-8000-000000007403" });
    fireEvent.click(screen.getByRole("button", { name: /^Fixture desktop/ }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "machine", machineId: "desktop" });
  });
});

describe("count line", () => {
  const summary = (view: ReturnType<typeof adaptSwarm>, mode: "tree" | "board" = "board") => render(<SwarmSummary view={view} anchor={anchor} mode={mode} onMode={vi.fn()} now={() => 0} />);

  test("above the board: busy slots of all slots on how many workers, by phase, each machine's share, and nothing free", () => {
    summary(adaptSwarm(demoSwarm(NOW, true), NOW));
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("7 of 9 slots busy on 2 workers");
    expect(status).toHaveTextContent("1 starting · 5 running · 1 finishing");
    expect(status.textContent).not.toMatch(/free|machine/);
    expect(texts(screen.getByRole("list", { name: "Machines" }))).toEqual(["Fixture desktop: 6 of 8 slots busy", "Fixture laptop: 1 of 1 slot busy"]);
  });

  test("above the board: what runs right now by model, most first, with each model's level colour", () => {
    summary(adaptSwarm(demoSwarm(NOW, true), NOW));
    const models = screen.getByRole("list", { name: "Models running now" });
    expect(texts(models)).toEqual(["claude-sonnet-5-5 ×4", "claude-haiku-5-5 ×2", "claude-opus-5-5 ×1"]);
    expect(within(models).getAllByRole("listitem").map(li => li.dataset.class)).toEqual(["standard", "fast", "deep"]);
  });

  test("a machine counts toward the headline only while one of its slots is busy", () => {
    const view = adaptSwarm(demoSwarm(NOW, true), NOW);
    view.machines[1]!.nodes[0]!.agents = []; view.machines[1]!.nodes[0]!.slots = { total: 4, occupied: 0, idle: 4, held: 0 };
    view.machines[1]!.nodes[0]!.holding = [{ code: "capability_expired", message: "Capability report expired", remedy: "Wait" }]; view.machines[1]!.state = "holding";
    summary(view);
    expect(screen.getByRole("status")).toHaveTextContent("6 of 9 slots busy on 1 worker");
    expect(texts(screen.getByRole("list", { name: "Machines" }))).toEqual(["Fixture desktop: 6 of 8 slots busy", "Fixture laptop: 0 of 1 slot busy · holding"]);
    expect(texts(screen.getByRole("list", { name: "Models running now" }))).toEqual(["claude-sonnet-5-5 ×4", "claude-haiku-5-5 ×1", "claude-opus-5-5 ×1"]);
  });

  test("an older server's held slots are busy and counted as starting or settling; nothing running has no model list", () => {
    const view = adaptSwarm(demoSwarm(NOW), NOW);
    const { unmount } = summary(view);
    expect(screen.getByRole("status")).toHaveTextContent("7 of 9 slots busy on 2 workers");
    expect(screen.getByRole("status")).toHaveTextContent("5 running · 2 starting or settling");
    unmount();
    for (const m of view.machines) for (const n of m.nodes) { n.agents = []; n.slots = { ...n.slots, occupied: 0, held: 0 }; }
    summary(view);
    expect(screen.getByRole("status")).toHaveTextContent("0 of 9 slots busy");
    expect(screen.queryByRole("list", { name: "Models running now" })).toBeNull();
  });

  test("above the tree the line is the board's: the same count, shares and models; and the age of the data runs", () => {
    vi.useFakeTimers();
    let mono = 0;
    const onMode = vi.fn();
    render(<SwarmSummary view={adaptSwarm(demoSwarm(NOW), NOW)} anchor={anchor} mode="tree" onMode={onMode} now={() => mono} />);
    expect(screen.getByRole("status")).toHaveTextContent("7 of 9 slots busy on 2 workers");
    expect(screen.getByRole("status")).toHaveTextContent("5 running · 2 starting or settling");
    expect(screen.getByRole("status").textContent).not.toMatch(/free|agents running|machine/);
    expect(texts(screen.getByRole("list", { name: "Machines" }))).toEqual(["Fixture desktop: 6 of 8 slots busy", "Fixture laptop: 1 of 1 slot busy"]);
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
    expect(texts(screen.getByRole("list", { name: "Machines" }))[0]).toBe("Fixture desktop: 6 of 8 slots busy");
    unmount();
    render(<SlotBoard view={view} anchor={anchor} selected={null} onSelect={vi.fn()} now={() => 0} />);
    expect(screen.getByRole("button", { name: /^Fixture desktop/ })).toHaveTextContent(/^Fixture desktoponline6 of 8 slots busy/);
    expect(screen.getByRole("button", { name: /^Fixture desktop/ }).textContent).not.toMatch(/holding/);
  });
  test("names an offline machine and says when the page is not updating", () => {
    render(<SwarmSummary view={adaptSwarm(SWARM_MOCKUP, SERVER_TIME)} anchor={{ serverTime: SERVER_TIME, receivedAt: 0 }} mode="board" onMode={vi.fn()} stale now={() => 0} />);
    expect(screen.getByRole("status")).toHaveTextContent("2 of 4 slots busy on 1 worker");
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
    expect(within(activity).getByRole("status")).toHaveTextContent("7 of 9 slots busy on 2 workers");
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
