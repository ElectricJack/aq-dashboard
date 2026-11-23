import type { NodeView } from "../../../api/adapters/swarm";
import { formatAge } from "../../../components/time/relative";
import { HELD_TEXT, NO_SLOT, selectionId, type Selection } from "./graph";
import { SLOT_LABEL, agentLines, agentState, clock, outputActivity, taskLabel, type NodeSlot, type Standing } from "./slots";
import styles from "./SlotBoard.module.css";

export type Drawn = { time: string; chosen: string | null; onSelect(s: Selection): void };

const STANDING_LABEL: Record<Standing, string> = {
  holding: "holding", draining: "draining", stopped: "stopped", offline: "offline", booting: "booting", revoked: "revoked", unknown: "state unknown",
};

export function slotKey(card: NodeSlot) {
  return card.kind === "agent" ? `agent:${card.agent.sessionId}` : `${card.kind}:${card.index}`;
}

type SlotProps = { n: NodeView; card: NodeSlot } & Drawn;

function FreeSlot({ n, card, chosen, onSelect, label }: Omit<SlotProps, "card" | "time"> & { card: Extract<NodeSlot, { kind: "free" }>; label: string }) {
  // Free: a small, quiet tile. On a node that takes no work it says what the node is doing instead, and selects the node.
  const selection: Selection = card.standing ? { kind: "node", nodeId: n.id } : { kind: "free", nodeId: n.id, index: card.index };
  const standing = card.standing ? STANDING_LABEL[card.standing] : "free";
  return (
    <li className={styles.cell} data-state={card.standing ?? "free"}>
      <button type="button" className={styles.tile} aria-pressed={!card.standing && chosen === selectionId(selection)} aria-label={`${label} ${standing}, ${n.name}`} onClick={() => onSelect(selection)}>
        {/* The tile reads "Slot 4 · free"; its name is the words drawn ("Slot 4 free"), then its worker's name. */}
        <span className={styles.name}>{label}</span>
        <span className="visually-hidden">{" ·"}</span>{" "}<span className={styles.standing}>{standing}</span>
      </button>
    </li>
  );
}

const HELD_SLOT = "An attempt holds this slot; no agent is listed yet";
function slotDetails(node: NodeView, card: Exclude<NodeSlot, { kind: "free" }>, time: string) {
  if (card.kind === "held") {
    const selection: Selection = { kind: "held", nodeId: node.id, index: card.index };
    return { phase: "held" as const, selection, title: SLOT_LABEL.held, lines: null, elapsed: null, output: null,
      facts: HELD_TEXT, drawn: `${SLOT_LABEL.held} ${HELD_SLOT}`, a: null };
  }
  const a = card.agent;
  const phase = agentState(a), title = taskLabel(a), lines = agentLines(a);
  const selection: Selection = { kind: "agent", sessionId: a.sessionId };
  const output = phase === "running" ? outputActivity(time, a.lastOutputAt) : null;
  const facts = [title, lines.who, lines.what].filter(Boolean).join(", ");
  const drawn = [title, lines.who, [SLOT_LABEL[phase], lines.what].filter(Boolean).join(" · ")].filter(Boolean).join(" ");
  return { phase, selection, title, lines, elapsed: clock(time, a.startedAt), output, facts, drawn, a };
}

function SlotMetadata({ facts, time }: { facts: ReturnType<typeof slotDetails>; time: string }) {
  const { lines, phase, output, a } = facts;
  if (!lines) return <>{" "}<span className={styles.meta}>{HELD_SLOT}</span></>;
  return <>
    {" "}<span className={styles.meta}>{lines.who}</span>
    {" "}<span className={styles.meta}>
      <span className={styles.phase}>{SLOT_LABEL[phase]}</span>
      {lines.what && ` · ${lines.what}`}
      {output && <span className={styles.output} data-output-age={` · output ${formatAge(time, a.lastOutputAt!)}`} aria-hidden="true" />}
    </span>
  </>;
}

export function Slot({ n, card, time, chosen, onSelect }: SlotProps) {
  const label = card.slot === null ? NO_SLOT : `Slot ${card.slot}`;
  if (card.kind === "free") return <FreeSlot n={n} card={card} chosen={chosen} onSelect={onSelect} label={label} />;
  const details = slotDetails(n, card, time);
  const { phase, selection, title, elapsed, output, facts, drawn, a } = details;
  return (
    <li className={styles.cell} data-state={phase} data-class={a?.intelligenceClass ?? "none"} data-output={output?.state} data-over={(card.slot === null && phase !== "stopped") || undefined}>
      <button type="button" className={styles.tile} aria-pressed={chosen === selectionId(selection)} title={`${n.name}: ${facts}`} aria-label={`${label}, ${n.name}, ${SLOT_LABEL[phase].toLowerCase()}: ${drawn}`} onClick={() => onSelect(selection)}>
        <span className={styles.head} aria-hidden="true">
          {/* Drawn by CSS from attributes, as the clock is: the tile's name already starts with its slot. */}
          <span className={styles.name} data-label={label} />
          {elapsed && <span className={styles.clock} data-clock={elapsed} />}
        </span>
        <span className={styles.top}><i className={styles.dot} aria-hidden="true" /><span className={styles.title} data-part="title">{title}</span></span>
        <SlotMetadata facts={details} time={time} />
      </button>
    </li>
  );
}
