import { useEffect, useMemo, useRef, type FocusEvent, type KeyboardEvent } from "react";
import { Background, Controls, ReactFlow, type ReactFlowInstance } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { SwarmView } from "../../../api/adapters/swarm";
import { buildSwarmGraph, layoutSwarm, selectionId, type Selection } from "./graph";
import { SwarmCard } from "./SwarmCard";
import styles from "./Swarm.module.css";

const nodeTypes = { card: SwarmCard };
const LEGEND: { label: string; color: string; ring?: boolean; dashed?: boolean }[] = [
  { label: "fast", color: "#1b7f6c" }, { label: "standard", color: "#57c" }, { label: "deep", color: "#a5c" }, { label: "unclassified", color: "#6b7280" },
  { label: "Codex (dark ring)", color: "#6b7280", ring: true }, { label: "free slot", color: "transparent", dashed: true }, { label: "waiting for a slot", color: "transparent", dashed: true },
];

/** The part of the React Flow instance the tree uses. */
type Flow = Pick<ReactFlowInstance, "setViewport" | "setCenter" | "getViewport" | "getInternalNode"> & { fitView(options: { padding: number; minZoom: number; maxZoom: number; duration: number }): unknown };

export function SwarmTree({ view, ready, selected, stale = false, onSelect }: { view: SwarmView; ready: number | null; selected: Selection | null; stale?: boolean; onSelect(s: Selection): void }) {
  const section = useRef<HTMLElement>(null);
  const laidOut = useMemo(() => {
    const graph = buildSwarmGraph(view, { host: window.location.host, ready, now: view.serverTime, stale });
    return { nodes: layoutSwarm(graph.nodes, graph.edges), edges: graph.edges };
  }, [view, ready, stale]);
  const chosen = selected ? selectionId(selected) : null;
  const nodes = useMemo(() => laidOut.nodes.map(n => ({ ...n, selected: n.id === chosen })), [laidOut, chosen]);
  // Open by fitting the whole tree (zoom 0.5 to 1). If it cannot fit even at 0.5, fall back to zoom 0.5 centred on the server root. The user pans.
  const FIT = { padding: 0.08, minZoom: 0.5, maxZoom: 1, duration: 0 } as const;
  const fitsAtMin = () => {
    const box = section.current;
    if (!box || laidOut.nodes.length === 0) return true;
    const size = (n: (typeof laidOut.nodes)[number]) => ({ w: n.width ?? n.data.box.width ?? 0, h: n.height ?? n.data.box.height ?? 0 });
    const w = Math.max(...laidOut.nodes.map(n => n.position.x + size(n).w)) - Math.min(...laidOut.nodes.map(n => n.position.x));
    const h = Math.max(...laidOut.nodes.map(n => n.position.y + size(n).h)) - Math.min(...laidOut.nodes.map(n => n.position.y));
    return w * FIT.minZoom * (1 + 2 * FIT.padding) <= box.clientWidth && h * FIT.minZoom * (1 + 2 * FIT.padding) <= box.clientHeight;
  };
  const centreRoot = (flow: Pick<Flow, "setViewport">) => {
    const width = section.current?.clientWidth ?? 0;
    const root = laidOut.nodes.find(n => n.id === "server");
    if (!width || !root) return;
    const zoom = FIT.minZoom;
    void flow.setViewport({ x: width / 2 - (root.position.x + (root.width ?? 0) / 2) * zoom, y: 24 - root.position.y * zoom, zoom });
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
    // Fit first so the fitted zoom is the starting zoom, then centre on the selection.
    void Promise.resolve(instance.fitView(FIT)).then(() => {
      if (target) reveal(target, true);
      else if (!fitsAtMin()) centreRoot(instance);
    });
  };
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
    if (event.key !== "Enter" && event.key !== " ") return;
    const holder = (event.target as HTMLElement).closest<HTMLElement>(".react-flow__node");
    const hit = holder && laidOut.nodes.find(n => n.id === holder.dataset.id);
    if (hit) { event.preventDefault(); choose(hit.data.selection); }
  };
  return (
    <div>
      <section ref={section} aria-label="Swarm tree" className={styles.flow} onKeyDown={keys} onFocus={focused}>
        <ReactFlow nodes={nodes} edges={laidOut.edges} nodeTypes={nodeTypes} onInit={onInit} nodesDraggable={false} nodesConnectable={false} nodesFocusable edgesFocusable={false} elementsSelectable
          proOptions={{ hideAttribution: true }} onNodeClick={(_, n) => choose(n.data.selection)} minZoom={0.5} maxZoom={2}>
          <Background gap={18} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </section>
      <ul className={styles.legend} aria-label="Legend">
        {LEGEND.map(l => (
          <li key={l.label}>
            <i style={{ background: l.color, ...(l.dashed ? { border: "1px dashed currentColor", boxSizing: "border-box" } : {}), ...(l.ring ? { boxShadow: "0 0 0 2px #111 inset" } : {}) }} />{l.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
