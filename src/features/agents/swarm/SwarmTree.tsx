import { useMemo } from "react";
import { Background, Controls, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { SwarmView } from "../../../api/adapters/swarm";
import { buildSwarmGraph, layoutSwarm, selectionId, type Selection } from "./graph";
import { SwarmCard } from "./SwarmCard";
import styles from "./Swarm.module.css";

const nodeTypes = { card: SwarmCard };
const LEGEND: { label: string; color: string; ring?: boolean; dashed?: boolean }[] = [
  { label: "fast", color: "#3a9" }, { label: "standard", color: "#57c" }, { label: "deep", color: "#a5c" }, { label: "unclassified", color: "#6b7280" },
  { label: "Codex (dark ring)", color: "#6b7280", ring: true }, { label: "free slot", color: "transparent", dashed: true }, { label: "waiting for a slot", color: "transparent", dashed: true },
];

export function SwarmTree({ view, ready, selected, onSelect }: { view: SwarmView; ready: number | null; selected: Selection | null; onSelect(s: Selection): void }) {
  const laidOut = useMemo(() => {
    const graph = buildSwarmGraph(view, { host: window.location.host, ready, now: view.serverTime });
    return { nodes: layoutSwarm(graph.nodes, graph.edges), edges: graph.edges };
  }, [view, ready]);
  const chosen = selected ? selectionId(selected) : null;
  const nodes = useMemo(() => laidOut.nodes.map(n => ({ ...n, selected: n.id === chosen })), [laidOut, chosen]);
  return (
    <div>
      <section aria-label="Swarm tree" className={styles.flow}>
        <ReactFlow nodes={nodes} edges={laidOut.edges} nodeTypes={nodeTypes} fitView nodesDraggable={false} nodesConnectable={false} elementsSelectable
          proOptions={{ hideAttribution: true }} onNodeClick={(_, n) => onSelect(n.data.selection)} minZoom={0.25} maxZoom={2}>
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
