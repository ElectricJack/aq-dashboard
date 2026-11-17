import { readFileSync } from "node:fs";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { adaptSwarm } from "../../../api/adapters/swarm";
import { SWARM_MOCKUP } from "../../../mocks/swarm";
import { SERVER_TIME } from "../../../mocks/inspectionData";
import { stubReactFlowDom } from "../../../test/reactFlow";
import { FIT, buildSwarmGraph, fitViewport, layoutForCanvas } from "./graph";
import { SwarmTree } from "./SwarmTree";

// The React Flow instance is replaced with a recording fake so pan calls can be asserted; nodes still render for real.
const flow = vi.hoisted(() => ({
  setCenter: vi.fn(), setViewport: vi.fn(), fitView: vi.fn(), props: {} as Record<string, unknown>, controls: {} as Record<string, unknown>,
  viewport: { x: 0, y: 0, zoom: 1.5 },
  nodes: new Map<string, { internals: { positionAbsolute: { x: number; y: number } }; measured: { width: number; height: number } }>(),
}));
vi.mock("@xyflow/react", async importOriginal => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...actual,
    ReactFlow: (props: React.ComponentProps<typeof actual.ReactFlow>) => {
      const { onInit, ...rest } = props;
      flow.props = props as unknown as Record<string, unknown>;
      const fake = { setCenter: flow.setCenter, setViewport: flow.setViewport, fitView: flow.fitView, getViewport: () => flow.viewport, getInternalNode: (id: string) => flow.nodes.get(id) };
      return <actual.ReactFlow {...rest} onInit={() => onInit?.(fake as never)} />;
    },
    Controls: (props: React.ComponentProps<typeof actual.Controls>) => { flow.controls = props as unknown as Record<string, unknown>; return <actual.Controls {...props} />; },
  };
});

let restore: () => void;
beforeAll(() => { restore = stubReactFlowDom(); });
afterAll(() => restore());
beforeEach(() => {
  flow.setCenter.mockClear(); flow.setViewport.mockClear(); flow.fitView.mockClear(); flow.nodes.clear(); flow.viewport = { x: 0, y: 0, zoom: 1.5 };
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 400 });
});
afterEach(() => { delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth; delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight; });

const view = adaptSwarm(SWARM_MOCKUP, SERVER_TIME);
const wrapperOf = async (name: RegExp) => (await screen.findByRole("button", { name })).closest<HTMLElement>(".react-flow__node")!;

test("node wrappers are focusable and the swarm tree styles their focus ring", async () => {
  render(<SwarmTree view={view} ready={6} selected={null} onSelect={vi.fn()} />);
  const wrapper = await wrapperOf(/^desktop, local/);
  expect(wrapper).toHaveAttribute("tabindex", "0");
  const css = readFileSync("src/features/agents/swarm/Swarm.module.css", "utf8");
  expect(css).toMatch(/\.flow :global\(\.react-flow__node\):focus-visible, \.flow :global\(\.react-flow__node\.selectable\):focus-visible \{ outline: 2px solid var\(--color-focus\); outline-offset: 2px; \}/);
});

test("focusing a card outside the viewport pans to its centre at the current zoom", async () => {
  render(<SwarmTree view={view} ready={6} selected={null} onSelect={vi.fn()} />);
  const wrapper = await wrapperOf(/^desktop, local/);
  flow.nodes.set(wrapper.dataset.id!, { internals: { positionAbsolute: { x: -300, y: 20 } }, measured: { width: 240, height: 52 } });
  const visible = vi.spyOn(HTMLElement.prototype, "matches").mockImplementation(function (this: HTMLElement, sel: string) { return sel === ":focus-visible" || Element.prototype.matches.call(this, sel); });
  fireEvent.focus(wrapper);
  visible.mockRestore();
  expect(flow.setCenter).toHaveBeenCalledWith(-300 + 120, 20 + 26, { zoom: 1.5, duration: 200 });
});

test("focusing a card fully inside the viewport does not pan", async () => {
  render(<SwarmTree view={view} ready={6} selected={null} onSelect={vi.fn()} />);
  const wrapper = await wrapperOf(/^desktop, local/);
  flow.nodes.set(wrapper.dataset.id!, { internals: { positionAbsolute: { x: 100, y: 20 } }, measured: { width: 240, height: 52 } });
  fireEvent.focus(wrapper);
  expect(flow.setCenter).not.toHaveBeenCalled();
});

/** The viewport that shows this view's whole tree in a canvas of this size. */
const fitted = (v: typeof view, width: number, height: number, ready = 6) => {
  const graph = buildSwarmGraph(v, { host: window.location.host, ready, now: v.serverTime, stale: false });
  return fitViewport(layoutForCanvas(graph.nodes, graph.edges, { width, height }).nodes, { width, height })!;
};
const canvas = (width: number, height: number) => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => width });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => height });
};

test("with no selection the tree opens fitted to its canvas: whole, centred, as large as it fits", async () => {
  canvas(5000, 5000);
  render(<SwarmTree view={view} ready={6} selected={null} onSelect={vi.fn()} />);
  await wrapperOf(/^desktop, local/);
  await waitFor(() => expect(flow.setViewport).toHaveBeenCalledWith(fitted(view, 5000, 5000), { duration: 0 }));
  // A small tree is not blown up past the largest opening zoom.
  expect(fitted(view, 5000, 5000).zoom).toBe(FIT.maxZoom);
  await new Promise(r => setTimeout(r, 20));
  expect(flow.setCenter).not.toHaveBeenCalled();
  expect(flow.fitView).not.toHaveBeenCalled();
});

test("on a smaller canvas the same tree opens at a smaller zoom, still whole", async () => {
  render(<SwarmTree view={view} ready={6} selected={null} onSelect={vi.fn()} />);
  await wrapperOf(/^desktop, local/);
  const viewport = fitted(view, 800, 400);
  await waitFor(() => expect(flow.setViewport).toHaveBeenLastCalledWith(viewport, { duration: 0 }));
  expect(viewport.zoom).toBeGreaterThan(FIT.minZoom);
  expect(viewport.zoom).toBeLessThan(FIT.maxZoom);
});

test("when the tree cannot fit at the smallest zoom it centres the server root at that zoom", async () => {
  canvas(900, 30);
  render(<SwarmTree view={view} ready={6} selected={null} onSelect={vi.fn()} />);
  await wrapperOf(/^desktop, local/);
  await waitFor(() => expect(flow.setViewport).toHaveBeenCalledWith(expect.objectContaining({ zoom: FIT.minZoom, y: 24 }), { duration: 0 }));
  expect(flow.setCenter).not.toHaveBeenCalled();
});

test("the tree fits again when the machines or nodes drawn change, and when its canvas does", async () => {
  const { rerender } = render(<SwarmTree view={view} ready={6} selected={null} onSelect={vi.fn()} />);
  await wrapperOf(/^desktop, local/);
  await waitFor(() => expect(flow.setViewport).toHaveBeenLastCalledWith(fitted(view, 800, 400), { duration: 0 }));
  const calls = flow.setViewport.mock.calls.length;
  // A poll that changes no machine or node (the same view again, an agent's facts) does not refit.
  const same = structuredClone(view); same.machines[0]!.nodes[0]!.agents[0]!.model = "another-model";
  rerender(<SwarmTree view={same} ready={6} selected={null} onSelect={vi.fn()} />);
  await new Promise(r => setTimeout(r, 20));
  expect(flow.setViewport).toHaveBeenCalledTimes(calls);
  // A machine's node goes: the tree is fitted to its new shape.
  const fewer = structuredClone(view); fewer.machines[0]!.nodes = fewer.machines[0]!.nodes.slice(0, 1);
  rerender(<SwarmTree view={fewer} ready={6} selected={null} onSelect={vi.fn()} />);
  await waitFor(() => expect(flow.setViewport).toHaveBeenLastCalledWith(fitted(fewer, 800, 400), { duration: 0 }));
});

test("once the viewer zooms or pans the tree stops fitting itself, until they press fit view", async () => {
  const { rerender } = render(<SwarmTree view={view} ready={6} selected={null} onSelect={vi.fn()} />);
  await wrapperOf(/^desktop, local/);
  await waitFor(() => expect(flow.setViewport).toHaveBeenCalled());
  const fewer = structuredClone(view); fewer.machines[0]!.nodes = fewer.machines[0]!.nodes.slice(0, 1);
  // React Flow's own viewport changes carry no event and do not count as the viewer's.
  (flow.props.onMoveStart as (e: unknown) => void)(null);
  rerender(<SwarmTree view={fewer} ready={6} selected={null} onSelect={vi.fn()} />);
  await waitFor(() => expect(flow.setViewport).toHaveBeenLastCalledWith(fitted(fewer, 800, 400), { duration: 0 }));
  // A wheel or a drag does.
  (flow.props.onMoveStart as (e: unknown) => void)(new Event("wheel"));
  const calls = flow.setViewport.mock.calls.length;
  rerender(<SwarmTree view={view} ready={6} selected={null} onSelect={vi.fn()} />);
  await new Promise(r => setTimeout(r, 20));
  expect(flow.setViewport).toHaveBeenCalledTimes(calls);
  // The zoom buttons are the viewer's too; "fit view" hands the view back.
  expect(flow.controls.onZoomIn).toBeInstanceOf(Function);
  expect(flow.controls.onZoomOut).toBeInstanceOf(Function);
  (flow.controls.onFitView as () => void)();
  await waitFor(() => expect(flow.setViewport).toHaveBeenCalledTimes(calls + 1));
  rerender(<SwarmTree view={fewer} ready={6} selected={null} onSelect={vi.fn()} />);
  await waitFor(() => expect(flow.setViewport).toHaveBeenLastCalledWith(fitted(fewer, 800, 400), { duration: 0 }));
});

test("with a selection the tree fits first, then centres the selected card when the fit leaves it outside", async () => {
  // The recording fake reports this viewport after the fit: here the selected card is outside the canvas.
  flow.viewport = { x: -5000, y: 0, zoom: 1.5 };
  render(<SwarmTree view={view} ready={6} selected={{ kind: "machine", machineId: "desktop" }} onSelect={vi.fn()} />);
  await waitFor(() => expect(flow.setCenter).toHaveBeenCalledWith(expect.any(Number), expect.any(Number), { zoom: 1.5, duration: 200 }));
  expect(flow.setViewport).toHaveBeenCalled();
  expect(flow.setViewport.mock.invocationCallOrder[0]!).toBeLessThan(flow.setCenter.mock.invocationCallOrder[0]!);
});

test("a selection the fit leaves inside the canvas is not centred: the whole tree stays in view", async () => {
  render(<SwarmTree view={view} ready={6} selected={{ kind: "server" }} onSelect={vi.fn()} />);
  flow.viewport = { x: 0, y: 0, zoom: 0.1 };
  await waitFor(() => expect(flow.setViewport).toHaveBeenCalled());
  await new Promise(r => setTimeout(r, 20));
  expect(flow.setCenter).not.toHaveBeenCalled();
});

test("Escape and a click on the empty canvas clear the selection", async () => {
  const onClear = vi.fn();
  const { rerender } = render(<SwarmTree view={view} ready={6} selected={null} onSelect={vi.fn()} onClear={onClear} />);
  const wrapper = await wrapperOf(/^desktop, local/);
  fireEvent.keyDown(wrapper, { key: "Escape" });
  expect(onClear).not.toHaveBeenCalled();
  rerender(<SwarmTree view={view} ready={6} selected={{ kind: "machine", machineId: "desktop" }} onSelect={vi.fn()} onClear={onClear} />);
  fireEvent.keyDown(wrapper, { key: "Escape" });
  expect(onClear).toHaveBeenCalledTimes(1);
  (flow.props.onPaneClick as () => void)();
  expect(onClear).toHaveBeenCalledTimes(2);
});

test("a selection that changes from outside pans to it, but a click inside the tree does not", async () => {
  const onSelect = vi.fn();
  const { rerender } = render(<SwarmTree view={view} ready={6} selected={null} onSelect={onSelect} />);
  await wrapperOf(/^desktop, local/);
  await waitFor(() => expect(flow.setViewport).toHaveBeenCalled());
  await new Promise(r => setTimeout(r, 20));
  rerender(<SwarmTree view={view} ready={6} selected={{ kind: "machine", machineId: "desktop" }} onSelect={onSelect} />);
  expect(flow.setCenter).toHaveBeenCalledTimes(1);
  flow.setCenter.mockClear();
  fireEvent.click((await wrapperOf(/^studio, local/)).querySelector("button")!);
  expect(onSelect).toHaveBeenCalled();
  rerender(<SwarmTree view={view} ready={6} selected={{ kind: "machine", machineId: "studio" }} onSelect={onSelect} />);
  expect(flow.setCenter).not.toHaveBeenCalled();
});

test("an agent card shows the task's title first, then role and level, then model and effort, with a running clock", async () => {
  const fleet = structuredClone(view);
  const agent = fleet.machines[0]!.nodes[0]!.agents[0]!;
  Object.assign(agent, { task: { id: "t", title: "Write an architecture overview" }, routingProfile: { id: "complex-low", displayName: "Complex, low" }, phase: "finishing", startedAt: new Date(Date.parse(SERVER_TIME) - 63_000).toISOString(),
    ranWith: { role: "writer", level: "complex-low", provider: "anthropic", model: "claude-opus-5-5", reasoning: "low", harness: "claude" } });
  let mono = 0;
  vi.useFakeTimers({ shouldAdvanceTime: true });
  render(<SwarmTree view={fleet} ready={6} selected={null} onSelect={vi.fn()} anchor={{ serverTime: SERVER_TIME, receivedAt: 0 }} now={() => mono} />);
  const card = await screen.findByRole("button", { name: "Write an architecture overview writer · Complex, low Finishing claude-opus-5-5 · low effort" });
  expect(card).toHaveAttribute("data-kind", "agent");
  expect(card).toHaveAttribute("data-level", "complex");
  expect(card).toHaveAttribute("data-phase", "finishing");
  // Title, then role and level with the phase, then model and effort.
  expect(card).toHaveTextContent(/^Write an architecture overview writer · Complex, low Finishing claude-opus-5-5 · low effort$/);
  expect(card.getAttribute("title")).toBe(`Write an architecture overview · ${agent.project.label} · writer · Complex, low · Finishing · claude-opus-5-5 · low effort`);
  const clock = () => card.querySelector("[data-clock]")!.getAttribute("data-clock");
  expect(clock()).toBe("1:03");
  mono = 4_000; act(() => vi.advanceTimersByTime(4_000));
  expect(clock()).toBe("1:07");
  vi.useRealTimers();
  // An older server's row keeps what it has: the class for the level, its harness or provider for the model.
  const codex = screen.getAllByRole("button", { name: / fast / }).find(b => b.getAttribute("data-kind") === "agent" && b.getAttribute("data-provider") === "codex")!;
  expect(codex).toHaveAttribute("data-level", "simple");
});

test("the legend names the levels the cards carry: simple, standard, complex, deep", async () => {
  render(<SwarmTree view={view} ready={6} selected={null} onSelect={vi.fn()} />);
  await wrapperOf(/^desktop, local/);
  const legend = Array.from(screen.getByRole("list", { name: "Legend" }).querySelectorAll("li")).map(li => li.textContent);
  expect(legend.slice(0, 5)).toEqual(["simple", "standard", "complex", "deep", "no level"]);
  expect(legend).not.toContain("fast");
});

test("a click-originated focus on a partially visible card does not pan", async () => {
  render(<SwarmTree view={view} ready={6} selected={null} onSelect={vi.fn()} />);
  const wrapper = await wrapperOf(/^desktop, local/);
  flow.nodes.set(wrapper.dataset.id!, { internals: { positionAbsolute: { x: -100, y: 20 } }, measured: { width: 240, height: 52 } });
  // A mouse click focuses the inner button, or the wrapper without :focus-visible.
  fireEvent.focus(wrapper.querySelector("button")!);
  fireEvent.focus(wrapper);
  expect(flow.setCenter).not.toHaveBeenCalled();
});

test("re-selecting the already selected card does not swallow the next outside change", async () => {
  // The recording fake reports this viewport after the fit: here the selected card is outside the canvas.
  flow.viewport = { x: -5000, y: 0, zoom: 1.5 };
  const onSelect = vi.fn();
  const desktop = { kind: "machine", machineId: "desktop" } as const;
  const { rerender } = render(<SwarmTree view={view} ready={6} selected={desktop} onSelect={onSelect} />);
  const wrapper = await wrapperOf(/^desktop, local/);
  await waitFor(() => expect(flow.setCenter).toHaveBeenCalledTimes(1));
  flow.setCenter.mockClear();
  fireEvent.click(wrapper.querySelector("button")!);
  fireEvent.keyDown(wrapper, { key: "Enter" });
  rerender(<SwarmTree view={view} ready={6} selected={{ kind: "machine", machineId: "studio" }} onSelect={onSelect} />);
  expect(flow.setCenter).toHaveBeenCalledTimes(1);
});

test("the selection centred at init is not centred a second time", async () => {
  // The recording fake reports this viewport after the fit: here the selected card is outside the canvas.
  flow.viewport = { x: -5000, y: 0, zoom: 1.5 };
  render(<SwarmTree view={view} ready={6} selected={{ kind: "machine", machineId: "desktop" }} onSelect={vi.fn()} />);
  await waitFor(() => expect(flow.setCenter).toHaveBeenCalledTimes(1));
  await new Promise(r => setTimeout(r, 50));
  expect(flow.setCenter).toHaveBeenCalledTimes(1);
});

test("a deep stacked agent and a free slot remain individually selectable without resetting the viewport", async () => {
  const fleet = structuredClone(view);
  const worker = fleet.machines.find(m => m.nodes.some(n => n.agents.length))!.nodes.find(n => n.agents.length)!;
  const sample = worker.agents[0]!;
  worker.agents = Array.from({ length: 100 }, (_, i) => ({ ...sample, sessionId: `stacked-${i}` }));
  worker.slots = { total: 102, occupied: 100, idle: 2 };
  // A real count of 102 slots, as a server that numbers slots reports it.
  worker.capacity = 102;
  const onSelect = vi.fn();
  const { container, rerender } = render(<SwarmTree view={fleet} ready={0} selected={null} onSelect={onSelect} />);
  await waitFor(() => expect(container.querySelector('[data-id="agent:stacked-99"] button')).toBeInTheDocument());
  await waitFor(() => expect(flow.setViewport).toHaveBeenCalled());
  await new Promise(r => setTimeout(r, 20));
  const fits = flow.setViewport.mock.calls.length;
  fireEvent.click(container.querySelector('[data-id="agent:stacked-99"] button')!);
  expect(onSelect).toHaveBeenLastCalledWith({ kind: "agent", sessionId: "stacked-99" });
  const free = container.querySelector(`[data-id="free:${worker.id}:1"]`)!;
  fireEvent.keyDown(free, { key: "Enter" });
  expect(onSelect).toHaveBeenLastCalledWith({ kind: "free", nodeId: worker.id, index: 1 });
  rerender(<SwarmTree view={fleet} ready={0} selected={{ kind: "free", nodeId: worker.id, index: 1 }} onSelect={onSelect} />);
  expect(flow.setViewport).toHaveBeenCalledTimes(fits);
  expect(flow.setCenter).not.toHaveBeenCalled();
});
