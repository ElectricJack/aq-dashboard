import { BaseEdge, type EdgeProps } from "@xyflow/react";
import styles from "./Swarm.module.css";

/** React Flow custom node "frame": the box behind a worker node and its slot cards. Decoration only. */
export function SlotFrame() {
  return <div className={styles.frame} aria-hidden="true" />;
}

/**
 * A machine's edge to one of its nodes: straight runs, so it never crosses a card. Down to a lane above the node's row,
 * along it and down; a node in a lower row is reached through the gap beside its column (`gutter`).
 */
export function BusEdge({ sourceX, sourceY, targetX, targetY, data, style, markerEnd }: EdgeProps) {
  const route = data as { lane?: number; upper?: number | null; gutter?: number | null } | undefined;
  const lane = route?.lane ?? (sourceY + targetY) / 2;
  const path = route?.gutter != null && route.upper != null
    ? `M ${sourceX} ${sourceY} V ${route.upper} H ${route.gutter} V ${lane} H ${targetX} V ${targetY}`
    : `M ${sourceX} ${sourceY} V ${lane} H ${targetX} V ${targetY}`;
  return <BaseEdge path={path} {...(style ? { style } : {})} {...(markerEnd ? { markerEnd } : {})} />;
}
