import { useEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { Background, Controls, ReactFlow, type ReactFlowInstance } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { SwarmView } from "../../../api/adapters/swarm";
import { useServerNow, type ServerAnchor } from "../../../components/time/useServerNow";
import { FIT, buildSwarmGraph, fitViewport, layoutForCanvas, routeEdges, selectionId, treeBounds, type Selection } from "./graph";
import { BusEdge, SwarmCard, SwarmTime } from "./SwarmCard";
import styles from "./Swarm.module.css";

const nodeTypes = { card: SwarmCard };
const edgeTypes = { bus: BusEdge };
// The colours the cards carry: an agent's level is the bar on its card.
const LEGEND: { label: string; color: string; ring?: boolean; dashed?: boolean; amber?: boolean }[] = [
  { label: "simple", color: "#2aa88a" }, { label: "standard", color: "#6f8fe0" }, { label: "complex", color: "#e0733d" }, { label: "deep", color: "#b96ad6" }, { label: "no level", color: "#6b7280" },
  { label: "Codex (dark ring)", color: "#6b7280", ring: true }, { label: "starting or finishing", color: "transparent", dashed: true, amber: true }, { label: "slot held (starting or settling)", color: "#c7802e" }, { label: "free slot", color: "transparent", dashed: true }, { label: "waiting for a slot", color: "transparent", dashed: true },
];

/** The part of the React Flow instance the tree uses. */
type Flow = Pick<ReactFlowInstance, "setViewport" | "setCenter" | "getViewport" | "getInternalNode">;

export function SwarmTree({ view, ready, selected, stale = false, onSelect, onClear, anchor, now }: { view: SwarmView; ready: number | null; selected: Selection | null; stale?: boolean; onSelect(s: Selection): void;
  /** Called when the canvas is clicked or Escape is pressed: nothing is selected. */ onClear?(): void; anchor?: ServerAnchor | undefined; now?: () => number }) {
  const section = useRef<HTMLElement>(null);
  const time = useServerNow(anchor, { tickMs: 1000, ...(now ? { now } : {}) });
  // The canvas size: the tree is laid out for it and opens fitted to it.
  const [canvas, setCanvas] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const element = section.current;
    if (!element) return;
    const measure = () => { const width = element.clientWidth, height = element.clientHeight; if (width > 0 && height > 0) setCanvas(c => (c && c.width === width && c.height === height ? c : { width, height })); };
    measure();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // Once the viewer zooms or pans, the view is theirs: the tree neither refits nor rewraps until they press "fit view".
  const moved = useRef(false);
  const wrap = useRef<{ columns: number; width: number; height: number } | null>(null);
  const graph = useMemo(() => buildSwarmGraph(view, { host: window.location.host, ready, now: view.serverTime, stale }), [view, ready, stale]);
  const laidOut = useMemo(() => {
    const kept = moved.current && wrap.current ? wrap.current : null;
    const placed = layoutForCanvas(graph.nodes, graph.edges, kept ?? canvas, kept?.columns);
    if (!kept && canvas) wrap.current = { columns: placed.columns, ...canvas };
    return { nodes: placed.nodes, edges: routeEdges(placed.nodes, graph.edges) };
  }, [graph, canvas]);
  const chosen = selected ? selectionId(selected) : null;
  const nodes = useMemo(() => laidOut.nodes.map(n => ({ ...n, selected: n.id === chosen })), [laidOut, chosen]);
  // What the fit depends on: which machines and nodes are drawn and how much room their cards take. Every slot card is
  // one size, so attempts starting and finishing do not change it.
  const shape = useMemo(() => {
    const b = treeBounds(laidOut.nodes);
    return `${Math.round(b.width)}x${Math.round(b.height)}|${laidOut.nodes.filter(n => n.data.kind === "machine" || n.data.kind === "node" || n.data.kind === "waiting").map(n => n.id).join(",")}`;
  }, [laidOut]);
  const size = () => ({ width: section.current?.clientWidth ?? 0, height: section.current?.clientHeight ?? 0 });
  /** Show the whole tree, as large as it fits. */
  const fit = (instance: Pick<Flow, "setViewport">) => {
    const viewport = fitViewport(laidOut.nodes, size());
    return viewport ? Promise.resolve(instance.setViewport(viewport, { duration: 0 })) : Promise.resolve();
  };
  const flow = useRef<Flow | null>(null);
  const ownSelectId = useRef<string | null>(null);
  const initCentred = useRef<string | null>(null);
  // Centre on a node at the current zoom; unless forced, only when its box is not fully inside the tree viewport.
  const reveal = (id: string, force: boolean) => {
    const instance = flow.current, box = section.current;
    if (!instance || !box) return;
    const found = laidOut.nodes.find(n => n.id === id);
    const internal = instance.getInternalNode(id);
    const pos = internal?.internals.positionAbsolute ?? found?.position;
    const w = internal?.measured.width ?? found?.data.box.width, h = internal?.measured.height ?? found?.data.box.height;
    if (!pos || !w || !h) return;
    const { x, y, zoom } = instance.getViewport();
    const left = pos.x * zoom + x, top = pos.y * zoom + y;
    const inside = left >= 0 && top >= 0 && left + w * zoom <= box.clientWidth && top + h * zoom <= box.clientHeight;
    if (force || !inside) void instance.setCenter(pos.x + w / 2, pos.y + h / 2, { zoom, duration: 200 });
  };
  const initialised = useRef(false);
  const onInit = (instance: Flow) => {
    flow.current = instance;
    initialised.current = true;
    if (laidOut.nodes.length === 0) return;
    const target = chosen && laidOut.nodes.some(n => n.id === chosen) ? chosen : null;
    if (target) initCentred.current = target;
    // Fit first so the fitted zoom is the starting zoom; a selection the fit leaves outside the canvas is then centred.
    void fit(instance).then(() => { if (target) reveal(target, false); });
  };
  // Fit again when the machines or nodes drawn change, or the canvas does (the properties pane opening, a window
  // resize): never after the viewer has zoomed or panned.
  useEffect(() => {
    if (!flow.current || moved.current) return;
    void fit(flow.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape, canvas?.width, canvas?.height]);
  // A selection that changes from outside the tree (?select=, history) pans to the card; a click inside the tree does not recentre.
  useEffect(() => {
    if (!chosen || !initialised.current) return;
    const mine = ownSelectId.current === chosen, centred = initCentred.current === chosen;
    ownSelectId.current = null; initCentred.current = null;
    if (mine || centred) return;
    reveal(chosen, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen]);
  const choose = (s: Selection) => { ownSelectId.current = selectionId(s); onSelect(s); };
  // Keyboard focus lands on the node wrapper; pan it into view when it is not fully visible. A mouse click focuses without :focus-visible and never pans.
  const focused = (event: FocusEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (!target.matches(".react-flow__node") || !target.matches(":focus-visible")) return;
    if (target.dataset.id) reveal(target.dataset.id, false);
  };
  // Enter and Space on a focused card select it (React Flow focuses the node and pans to it).
  const keys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && chosen && onClear) { onClear(); return; }
    if (event.key !== "Enter" && event.key !== " ") return;
    const holder = (event.target as HTMLElement).closest<HTMLElement>(".react-flow__node");
    const hit = holder && laidOut.nodes.find(n => n.id === holder.dataset.id);
    if (hit) { event.preventDefault(); choose(hit.data.selection); }
  };
  const refit = () => { moved.current = false; if (flow.current) void fit(flow.current); };
  return (
    <div>
      <section ref={section} aria-label="Swarm tree" className={styles.flow} onKeyDown={keys} onFocus={focused}>
        <SwarmTime.Provider value={time ?? view.serverTime}>
          <ReactFlow nodes={nodes} edges={laidOut.edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onInit={onInit} nodesDraggable={false} nodesConnectable={false} nodesFocusable edgesFocusable={false} elementsSelectable
            proOptions={{ hideAttribution: true }} onNodeClick={(_, n) => choose(n.data.selection)} {...(onClear ? { onPaneClick: () => onClear() } : {})}
            // React Flow reports a wheel, drag or pinch with its event, and its own viewport changes without one.
            onMoveStart={event => { if (event) moved.current = true; }} minZoom={FIT.minZoom} maxZoom={2}>
            <Background gap={18} size={1} />
            <Controls position="top-left" showInteractive={false} fitViewOptions={{ padding: FIT.padding, minZoom: FIT.minZoom, maxZoom: FIT.maxZoom }} onZoomIn={() => { moved.current = true; }} onZoomOut={() => { moved.current = true; }} onFitView={refit} />
          </ReactFlow>
        </SwarmTime.Provider>
      </section>
      <ul className={styles.legend} aria-label="Legend">
        {LEGEND.map(l => (
          <li key={l.label}>
            <i style={{ background: l.color, ...(l.dashed ? { border: `1px dashed ${l.amber ? "#c7802e" : "currentColor"}`, boxSizing: "border-box" } : {}), ...(l.ring ? { boxShadow: "0 0 0 2px #111 inset" } : {}) }} />{l.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
