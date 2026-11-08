import { readFileSync } from "node:fs";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { adaptSwarm } from "../../../api/adapters/swarm";
import { SWARM_MOCKUP } from "../../../mocks/swarm";
import { SERVER_TIME } from "../../../mocks/inspectionData";
import { stubReactFlowDom } from "../../../test/reactFlow";
import { SwarmTree } from "./SwarmTree";

// The React Flow instance is replaced with a recording fake so pan calls can be asserted; nodes still render for real.
const flow = vi.hoisted(() => ({
  setCenter: vi.fn(), setViewport: vi.fn(), fitView: vi.fn(),
  viewport: { x: 0, y: 0, zoom: 1.5 },
  nodes: new Map<string, { internals: { positionAbsolute: { x: number; y: number } }; measured: { width: number; height: number } }>(),
}));
vi.mock("@xyflow/react", async importOriginal => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...actual,
    ReactFlow: (props: React.ComponentProps<typeof actual.ReactFlow>) => {
      const { onInit, ...rest } = props;
      const fake = { setCenter: flow.setCenter, setViewport: flow.setViewport, fitView: flow.fitView, getViewport: () => flow.viewport, getInternalNode: (id: string) => flow.nodes.get(id) };
      return <actual.ReactFlow {...rest} onInit={() => onInit?.(fake as never)} />;
    },
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

const FIT = { padding: 0.08, minZoom: 0.5, maxZoom: 1, duration: 0 };

test("with no selection the tree opens by fitting the whole tree", async () => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 5000 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 5000 });
  render(<SwarmTree view={view} ready={6} selected={null} onSelect={vi.fn()} />);
  await wrapperOf(/^desktop, local/);
  await waitFor(() => expect(flow.fitView).toHaveBeenCalledWith(FIT));
  await new Promise(r => setTimeout(r, 20));
  expect(flow.setCenter).not.toHaveBeenCalled();
  expect(flow.setViewport).not.toHaveBeenCalled();
});

test("when the tree cannot fit at 0.5 it centres the server root at zoom 0.5", async () => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 100 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 100 });
  render(<SwarmTree view={view} ready={6} selected={null} onSelect={vi.fn()} />);
  await wrapperOf(/^desktop, local/);
  await waitFor(() => expect(flow.setViewport).toHaveBeenCalledWith(expect.objectContaining({ zoom: 0.5 })));
  expect(flow.fitView).toHaveBeenCalledWith(FIT);
  expect(flow.setCenter).not.toHaveBeenCalled();
});

test("with a selection the tree fits first, then centres the selected node", async () => {
  render(<SwarmTree view={view} ready={6} selected={{ kind: "machine", machineId: "desktop" }} onSelect={vi.fn()} />);
  await waitFor(() => expect(flow.setCenter).toHaveBeenCalledWith(expect.any(Number), expect.any(Number), { zoom: 1.5, duration: 200 }));
  expect(flow.fitView).toHaveBeenCalledWith(FIT);
  expect(flow.fitView.mock.invocationCallOrder[0]!).toBeLessThan(flow.setCenter.mock.invocationCallOrder[0]!);
  expect(flow.setViewport).not.toHaveBeenCalled();
});

test("a selection that changes from outside pans to it, but a click inside the tree does not", async () => {
  const onSelect = vi.fn();
  const { rerender } = render(<SwarmTree view={view} ready={6} selected={null} onSelect={onSelect} />);
  await wrapperOf(/^desktop, local/);
  await waitFor(() => expect(flow.fitView).toHaveBeenCalled());
  await new Promise(r => setTimeout(r, 20));
  rerender(<SwarmTree view={view} ready={6} selected={{ kind: "machine", machineId: "desktop" }} onSelect={onSelect} />);
  expect(flow.setCenter).toHaveBeenCalledTimes(1);
  flow.setCenter.mockClear();
  fireEvent.click((await wrapperOf(/^studio, local/)).querySelector("button")!);
  expect(onSelect).toHaveBeenCalled();
  rerender(<SwarmTree view={view} ready={6} selected={{ kind: "machine", machineId: "studio" }} onSelect={onSelect} />);
  expect(flow.setCenter).not.toHaveBeenCalled();
});

test("agent pills carry their full text as a title and show the harness", async () => {
  render(<SwarmTree view={view} ready={6} selected={null} onSelect={vi.fn()} />);
  const pills = (await screen.findAllByRole("button", { name: /^claude · standard/ })).filter(b => b.getAttribute("data-kind") === "agent");
  expect(pills[0]).toHaveAttribute("title", "claude · standard");
  const codex = (await screen.findAllByRole("button", { name: /^codex · fast/ })).find(b => b.getAttribute("data-kind") === "agent");
  expect(codex).toHaveAttribute("title", "codex · fast");
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
  render(<SwarmTree view={view} ready={6} selected={{ kind: "machine", machineId: "desktop" }} onSelect={vi.fn()} />);
  await waitFor(() => expect(flow.setCenter).toHaveBeenCalledTimes(1));
  await new Promise(r => setTimeout(r, 50));
  expect(flow.setCenter).toHaveBeenCalledTimes(1);
});
