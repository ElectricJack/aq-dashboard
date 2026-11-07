import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { SwarmCardData } from "./graph";
import styles from "./Swarm.module.css";

const fill = (percent: number) => (percent > 85 ? "#d55" : percent > 65 ? "#db4" : "#3a9");
const PILL = new Set(["agent", "waitingAgent"]);
const handle = { opacity: 0, pointerEvents: "none" as const };

/** React Flow custom node "card": one button per tree object, named by its aria label. */
export function SwarmCard({ data }: NodeProps<Node<SwarmCardData>>) {
  const pill = PILL.has(data.kind);
  return (
    <>
      {data.kind !== "server" && <Handle type="target" position={Position.Top} isConnectable={false} style={handle} />}
      <button type="button" className={pill ? `${styles.card} ${styles.pill}` : styles.card} data-kind={data.kind} data-state={data.state ?? undefined}
        data-machine-kind={data.machineKind ?? undefined} data-class={pill ? data.intelligenceClass ?? "none" : undefined} data-provider={pill ? data.provider ?? undefined : undefined}
        aria-label={data.ariaLabel}>
        <span className={styles.title}>{data.label}</span>
        {data.sub && <span className={styles.sub}>{data.sub}</span>}
        {data.reason && <span className={styles.reason}>{data.reason}</span>}
        {data.meters && (
          <span className={styles.meters} data-stale={data.stale || undefined}>
            {data.meters.map(m => (
              <span key={m.label} className={styles.meter}>
                <span>{m.label}</span>
                <span className={styles.bar}><i style={{ width: `${Math.min(100, m.percent)}%`, background: fill(m.percent) }} /></span>
                <span>{m.percent}%</span>
              </span>
            ))}
          </span>
        )}
      </button>
      {!["agent", "free", "waitingAgent"].includes(data.kind) && <Handle type="source" position={Position.Bottom} isConnectable={false} style={handle} />}
    </>
  );
}
