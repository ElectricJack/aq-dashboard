import { createContext, useContext } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { NO_SLOT, type SwarmCardData } from "./graph";
import { SLOT_LABEL, clock } from "./slots";
import styles from "./Swarm.module.css";

export { BusEdge, SlotFrame } from "./SwarmEdges";

const fill = (percent: number) => (percent > 85 ? "#d55" : percent > 65 ? "#db4" : "#3a9");
const PILL = new Set(["waitingAgent"]);
const handle = { opacity: 0, pointerEvents: "none" as const };

/** The server's time, ticking each second, for the agent cards' clocks. Null where nothing ticks (the clock is then not drawn). */
export const SwarmTime = createContext<string | null>(null);

function slotLabel(slot: number | null) {
  return slot === null ? NO_SLOT : `Slot ${slot}`;
}

function AgentFacts({ agent, data }: { agent: NonNullable<SwarmCardData["agent"]>; data: SwarmCardData }) {
  const elapsed = clock(useContext(SwarmTime), agent.startedAt);
  return <>
    {/* Title first and large, then role and level with the phase and the clock, then model and effort. */}
    {" "}<span className={styles.foot}>
      <span className={styles.what}>{agent.who}</span>
      {agent.phase !== "running" && <>{" "}<span className={styles.phase}>{SLOT_LABEL[agent.phase]}</span></>}
      {elapsed && <span className={styles.clock} data-clock={elapsed} aria-hidden="true" />}
    </span>
    {" "}<span className={styles.sub}>{agent.what}</span>
    {/* The slot is the card's first line on screen and the last words of its name. */}
    {(data.slot !== null || data.over) && <>{" "}<span className={styles.slot}>{slotLabel(data.slot)}</span></>}
  </>;
}

function CardSlot({ data }: { data: SwarmCardData }) {
  const beyondNode = data.over && data.kind !== "node";
  if (data.slot === null && !beyondNode) return null;
  return <><span className={styles.slot} aria-hidden="true">{slotLabel(data.slot)}</span>{" "}</>;
}

function CardMeters({ data }: { data: SwarmCardData }) {
  if (!data.meters) return null;
  return (
    <span className={styles.meters} data-stale={data.stale || undefined} aria-hidden="true">
      {data.meters.map(m => (
        <span key={m.label} className={styles.meter} data-label={m.label} data-value={`${m.percent}%`}>
          <span className={styles.bar}><i style={{ width: `${Math.min(100, m.percent)}%`, background: fill(m.percent) }} /></span>
        </span>
      ))}
    </span>
  );
}

function CardDescription({ data }: { data: SwarmCardData }) {
  return <>
    {data.sub && <>{" "}<span className={styles.sub} aria-hidden="true">{data.sub}</span></>}
    {data.reason && <>{" "}<span className={styles.reason} aria-hidden="true">{data.reason}</span></>}
  </>;
}

function cardName(data: SwarmCardData) {
  if (data.agent) return undefined;
  return data.meters ? `${data.ariaLabel}, ${data.meters.map(m => `${m.label} ${m.percent}%`).join(", ")}` : data.ariaLabel;
}

function cardAppearance(data: SwarmCardData) {
  const common = {
    className: styles.card,
    "data-kind": data.kind, "data-state": data.state, "data-machine-kind": data.machineKind,
    "data-over": data.over || undefined, title: data.tooltip ?? undefined,
  };
  const agent = data.agent;
  if (PILL.has(data.kind)) {
    return { ...common, className: `${styles.card} ${styles.pill}`, "data-class": data.intelligenceClass ?? "none",
      "data-provider": data.provider, title: data.tooltip ?? data.label,
      ...(agent && { "data-phase": agent.phase, "data-level": agent.level ?? "none" }) };
  }
  if (agent) return { ...common, "data-phase": agent.phase, "data-level": agent.level ?? "none", "data-provider": data.provider };
  return common;
}

/** React Flow custom node "card": one button per tree object, named by its aria label. */
export function SwarmCard({ data }: NodeProps<Node<SwarmCardData>>) {
  const agent = data.agent;
  return (
    <>
      {data.kind !== "server" && <Handle type="target" position={Position.Top} isConnectable={false} style={handle} />}
      {/* An agent card is named by its text, so a card the canvas clips in part still reads as its name; every other
          card's text is drawn for the eye and its name is its label. The clock is drawn by CSS from an attribute (as the
          meters are), so no name changes every second. */}
      <button type="button" {...cardAppearance(data)}
        tabIndex={-1}
        aria-label={cardName(data)}>
        {!agent && <CardSlot data={data} />}
        <span className={styles.title} data-part="title" aria-hidden={agent ? undefined : true}>{data.label}</span>
        {agent ? <AgentFacts agent={agent} data={data} /> : <CardDescription data={data} />}
        <CardMeters data={data} />
      </button>
      {!["agent", "free", "held", "waitingAgent"].includes(data.kind) && <Handle type="source" position={Position.Bottom} isConnectable={false} style={handle} />}
    </>
  );
}
