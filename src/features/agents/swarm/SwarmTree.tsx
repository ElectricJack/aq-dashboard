import { useMemo, useRef, type KeyboardEvent } from "react";
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

export function SwarmTree({ view, ready, selected, stale = false, onSelect }: { view: SwarmView; ready: number | null; selected: Selection | null; stale?: boolean; onSelect(s: Selection): void }) {
  const section = useRef<HTMLElement>(null);
  const laidOut = useMemo(() => {
    const graph = buildSwarmGraph(view, { host: window.location.host, ready, now: view.serverTime, stale });
    return { nodes: layoutSwarm(graph.nodes, graph.edges), edges: graph.edges };
  }, [view, ready, stale]);
  const chosen = selected ? selectionId(selected) : null;
  const nodes = useMemo(() => laidOut.nodes.map(n => ({ ...n, selected: n.id === chosen })), [laidOut, chosen]);
  // Open at zoom 1 so card text is never under 12px: the whole tree when it fits, otherwise centred on the server root. The user pans.
  const open = (flow: { setViewport: ReactFlowInstance["setViewport"] }) => {
    const width = section.current?.clientWidth ?? 0;
    if (!width || laidOut.nodes.length === 0) return;
    const left = Math.min(...laidOut.nodes.map(n => n.position.x)), right = Math.max(...laidOut.nodes.map(n => n.position.x + (n.width ?? 0)));
    const top = Math.min(...laidOut.nodes.map(n => n.position.y));
    const root = laidOut.nodes.find(n => n.id === "server");
    const fits = right - left + 48 <= width;
    const centre = fits || !root ? (left + right) / 2 : root.position.x + (root.width ?? 0) / 2;
    void flow.setViewport({ x: width / 2 - centre, y: 24 - top, zoom: 1 });
  };
  // Enter and Space on a focused card select it (React Flow focuses the node and pans to it).
  const keys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const holder = (event.target as HTMLElement).closest<HTMLElement>(".react-flow__node");
    const hit = holder && laidOut.nodes.find(n => n.id === holder.dataset.id);
    if (hit) { event.preventDefault(); onSelect(hit.data.selection); }
  };
  return (
    <div>
      <section ref={section} aria-label="Swarm tree" className={styles.flow} onKeyDown={keys}>
        <ReactFlow nodes={nodes} edges={laidOut.edges} nodeTypes={nodeTypes} onInit={open} nodesDraggable={false} nodesConnectable={false} nodesFocusable edgesFocusable={false} elementsSelectable
          proOptions={{ hideAttribution: true }} onNodeClick={(_, n) => onSelect(n.data.selection)} minZoom={0.5} maxZoom={2}>
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
