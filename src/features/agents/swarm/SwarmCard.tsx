import { createContext, useContext } from "react";
import { BaseEdge, Handle, Position, type EdgeProps, type Node, type NodeProps } from "@xyflow/react";
import type { SwarmCardData } from "./graph";
import { SLOT_LABEL, clock } from "./slots";
import styles from "./Swarm.module.css";

const fill = (percent: number) => (percent > 85 ? "#d55" : percent > 65 ? "#db4" : "#3a9");
const PILL = new Set(["waitingAgent"]);
const handle = { opacity: 0, pointerEvents: "none" as const };

/** The server's time, ticking each second, for the agent cards' clocks. Null where nothing ticks (the clock is then not drawn). */
export const SwarmTime = createContext<string | null>(null);

/** React Flow custom node "card": one button per tree object, named by its aria label. */
export function SwarmCard({ data }: NodeProps<Node<SwarmCardData>>) {
  const pill = PILL.has(data.kind);
  const time = useContext(SwarmTime);
  const agent = data.agent;
  const elapsed = agent ? clock(time, agent.startedAt) : null;
  return (
    <>
      {data.kind !== "server" && <Handle type="target" position={Position.Top} isConnectable={false} style={handle} />}
      {/* An agent card is named by its text, so a card the canvas clips in part still reads as its name; every other
          card's text is drawn for the eye and its name is its label. The clock is drawn by CSS from an attribute (as the
          meters are), so no name changes every second. */}
      <button type="button" className={pill ? `${styles.card} ${styles.pill}` : styles.card} data-kind={data.kind} data-state={data.state ?? undefined}
        data-machine-kind={data.machineKind ?? undefined} data-class={pill ? data.intelligenceClass ?? "none" : undefined} data-level={agent ? agent.level ?? "none" : undefined}
        data-phase={agent?.phase} data-provider={pill || agent ? data.provider ?? undefined : undefined}
        tabIndex={-1} title={data.tooltip ?? (pill ? data.label : undefined)}
        {...(agent ? {} : { "aria-label": data.meters ? `${data.ariaLabel}, ${data.meters.map(m => `${m.label} ${m.percent}%`).join(", ")}` : data.ariaLabel })}>
        {data.slot !== null && <><span className={styles.slot} aria-hidden={agent ? undefined : true}>{`Slot ${data.slot}`}</span>{agent && " "}</>}
        <span className={styles.title} aria-hidden={agent ? undefined : true}>{data.label}</span>
        {agent ? <>
          {/* Title first and large, then role and level with the phase and the clock, then model and effort. */}
          {" "}<span className={styles.foot}>
            <span className={styles.what}>{agent.who}</span>
            {agent.phase !== "running" && <>{" "}<span className={styles.phase}>{SLOT_LABEL[agent.phase]}</span></>}
            {elapsed && <span className={styles.clock} data-clock={elapsed} aria-hidden="true" />}
          </span>
          {" "}<span className={styles.sub}>{agent.what}</span>
        </> : <>
          {data.sub && <>{" "}<span className={styles.sub} aria-hidden="true">{data.sub}</span></>}
          {data.reason && <>{" "}<span className={styles.reason} aria-hidden="true">{data.reason}</span></>}
        </>}
        {data.meters && (
          <span className={styles.meters} data-stale={data.stale || undefined} aria-hidden="true">
            {data.meters.map(m => (
              <span key={m.label} className={styles.meter} data-label={m.label} data-value={`${m.percent}%`}>
                <span className={styles.bar}><i style={{ width: `${Math.min(100, m.percent)}%`, background: fill(m.percent) }} /></span>
              </span>
            ))}
          </span>
        )}
      </button>
      {!["agent", "free", "held", "waitingAgent"].includes(data.kind) && <Handle type="source" position={Position.Bottom} isConnectable={false} style={handle} />}
    </>
  );
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
