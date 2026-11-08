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
type Flow = Pick<ReactFlowInstance, "setViewport" | "setCenter" | "getViewport" | "getInternalNode">;

export function SwarmTree({ view, ready, selected, stale = false, onSelect }: { view: SwarmView; ready: number | null; selected: Selection | null; stale?: boolean; onSelect(s: Selection): void }) {
  const section = useRef<HTMLElement>(null);
  const laidOut = useMemo(() => {
    const graph = buildSwarmGraph(view, { host: window.location.host, ready, now: view.serverTime, stale });
    return { nodes: layoutSwarm(graph.nodes, graph.edges), edges: graph.edges };
  }, [view, ready, stale]);
  const chosen = selected ? selectionId(selected) : null;
  const nodes = useMemo(() => laidOut.nodes.map(n => ({ ...n, selected: n.id === chosen })), [laidOut, chosen]);
  // Open at zoom 1 so card text is never under 12px: the whole tree when it fits, otherwise centred on the server root. The user pans.
  const open = (flow: Pick<Flow, "setViewport">) => {
    const width = section.current?.clientWidth ?? 0;
    if (!width || laidOut.nodes.length === 0) return;
    const left = Math.min(...laidOut.nodes.map(n => n.position.x)), right = Math.max(...laidOut.nodes.map(n => n.position.x + (n.width ?? 0)));
    const top = Math.min(...laidOut.nodes.map(n => n.position.y));
    const root = laidOut.nodes.find(n => n.id === "server");
    const fits = right - left + 48 <= width;
    const centre = fits || !root ? (left + right) / 2 : root.position.x + (root.width ?? 0) / 2;
    void flow.setViewport({ x: width / 2 - centre, y: 24 - top, zoom: 1 });
  };
  const flow = useRef<Flow | null>(null);
  const ownSelect = useRef(false);
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
    if (chosen && laidOut.nodes.some(n => n.id === chosen)) { open(instance); reveal(chosen, true); } else open(instance);
  };
  // A selection that changes from outside the tree (?select=, history) pans to the card; a click inside the tree does not recentre.
  useEffect(() => {
    if (!chosen || !initialised.current) return;
    if (ownSelect.current) { ownSelect.current = false; return; }
    reveal(chosen, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen]);
  const choose = (s: Selection) => { ownSelect.current = true; onSelect(s); };
  // Keyboard focus lands on the node wrapper; pan it into view when it is not fully visible.
  const focused = (event: FocusEvent<HTMLElement>) => {
    const holder = (event.target as HTMLElement).closest<HTMLElement>(".react-flow__node");
    if (holder?.dataset.id) reveal(holder.dataset.id, false);
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
