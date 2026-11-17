import type { CSSProperties } from "react";
import type { AgentView, MachineView, NodeView, SwarmView } from "../../../api/adapters/swarm";
import { formatAge } from "../../../components/time/relative";
import { useServerNow, type ServerAnchor } from "../../../components/time/useServerNow";
import { HELD_TEXT, NO_SLOT, nodeLine, overText, selectionId, type Selection } from "./graph";
import { SLOT_LABEL, agentLines, agentState, busyOnWorkers, clock, holdingNodes, machineShare, machineSlots, nodeSlots, nodeStanding, outputActivity, overSlots, phaseParts, shownMachineState, taskLabel, workerCounts, workerHeadline, type NodeSlot, type Standing } from "./slots";
import styles from "./SlotBoard.module.css";

export type SwarmViewMode = "tree" | "board";
type Tick = { now?: () => number };

/**
 * The count line above the tree and above the board, the same for both: slots busy of all slots on how many workers
 * (a worker is a worker node), in which phase, each machine's share, and what runs by model. One count
 * (`workerCounts`) feeds it, from the rows the page draws. The age of the last update is real: it restarts when a poll
 * succeeds and keeps counting when one does not.
 */
export function SwarmSummary({ view, anchor, mode, onMode, stale = false, now }: { view: SwarmView; anchor: ServerAnchor | undefined; mode: SwarmViewMode; onMode(mode: SwarmViewMode): void; stale?: boolean } & Tick) {
  const time = useServerNow(anchor, { tickMs: 1000, ...(now ? { now } : {}) });
  const counts = workerCounts(view);
  return (
    <section className={styles.summary} aria-label="Swarm activity" data-stale={stale || undefined} data-mode={mode}>
      <p className={styles.headline} role="status">
        <strong>{workerHeadline(counts)}</strong>
        <span className={styles.rest}>{phaseParts(counts).join(" · ")}</span>
      </p>
      <ul className={styles.machines} aria-label="Machines">
        {counts.machines.map(m => <li key={m.id} data-state={m.state} data-busy={m.busy > 0 || undefined}>{machineShare(m)}</li>)}
      </ul>
      <span className={styles.updated} data-stale={stale || undefined}>{stale ? "Not updating" : time ? `Updated ${formatAge(time, view.serverTime)}` : ""}</span>
      <div className={styles.modes} role="group" aria-label="Swarm view">
        {(["tree", "board"] as const).map(m => <button key={m} type="button" aria-pressed={mode === m} onClick={() => onMode(m)}>{m === "tree" ? "Tree" : "Board"}</button>)}
      </div>
      {counts.models.length > 0 && <ul className={styles.models} aria-label="Models running now">
        {counts.models.map(m => <li key={m.model} data-class={m.cls ?? "none"}><i aria-hidden="true" />{`${m.model} ×${m.count}`}</li>)}
      </ul>}
    </section>
  );
}

/**
 * The tree's model as tiles, readable at a distance and without zooming: machine, then each of its worker nodes, then
 * one tile per slot of that node in slot order. A busy tile is the same object as the tree's agent card and selects
 * the same properties pane; a free tile selects its free slot, and a worker's name its node.
 */
export function SlotBoard({ view, anchor, selected, onSelect, now }: { view: SwarmView; anchor: ServerAnchor | undefined; selected: Selection | null; onSelect(s: Selection): void } & Tick) {
  const time = useServerNow(anchor, { tickMs: 1000, ...(now ? { now } : {}) });
  const chosen = selected ? selectionId(selected) : null;
  return (
    <div>
      <section className={styles.board} aria-label="Swarm board">
        {view.machines.length === 0 && <p className={styles.note}>No machines.</p>}
        {view.machines.map(m => <Machine key={m.id} m={m} time={time ?? view.serverTime} chosen={chosen} onSelect={onSelect} />)}
      </section>
    </div>
  );
}

function machineLine(m: MachineView, time: string): string {
  switch (shownMachineState(m)) {
    case "offline": return m.lastSeenAt ? `offline · last seen ${formatAge(time, m.lastSeenAt)}` : "offline";
    case "stopped": return "stopped";
    case "booting": return "booting";
    default: {
      const load = m.load ? ` · CPU ${m.load.cpuPercent}% · RAM ${m.load.memoryPercent}%${m.load.fresh ? "" : " (stale)"}` : "";
      return `${busyOnWorkers(machineSlots(m))}${load}`;
    }
  }
}

type Drawn = { time: string; chosen: string | null; onSelect(s: Selection): void };

function Machine({ m, time, chosen, onSelect }: { m: MachineView } & Drawn) {
  const selection: Selection = { kind: "machine", machineId: m.id };
  // A hold is shown only while one of the machine's nodes holds in this response.
  const state = shownMachineState(m), hold = holdingNodes(m)[0]?.holding[0];
  return (
    <div className={styles.machine} data-state={state}>
      <button type="button" className={styles.machineHead} aria-pressed={chosen === selectionId(selection)} onClick={() => onSelect(selection)}>
        <strong>{m.label}</strong>
        <span className={styles.state} data-state={state}>{state === "unknown" ? "state unknown" : state}</span>
        <span className={styles.line}>{machineLine(m, time)}</span>
        {hold && <span className={styles.hold}>{`holding: ${hold.message}`}</span>}
      </button>
      {m.nodes.length > 0 && <div className={styles.workers}>
        {m.nodes.map(n => <Worker key={n.id} m={m} n={n} time={time} chosen={chosen} onSelect={onSelect} />)}
      </div>}
    </div>
  );
}

export { agentLines };

const STANDING_LABEL: Record<Standing, string> = {
  holding: "holding", draining: "draining", stopped: "stopped", offline: "offline", booting: "booting", revoked: "revoked", unknown: "state unknown",
};

/** A worker node: its name with how many of its slots are busy (or what it is doing instead), then one tile per slot. */
function Worker({ m, n, time, chosen, onSelect }: { m: MachineView; n: NodeView } & Drawn) {
  const node: Selection = { kind: "node", nodeId: n.id };
  const why = nodeStanding(m, n), cards = nodeSlots(m, n), over = overSlots(m, n);
  return (
    <section className={styles.worker} aria-label={n.name} data-state={why.standing ?? undefined} data-over={over > 0 || undefined} style={{ "--across": Math.max(1, Math.min(4, cards.length)) } as CSSProperties}>
      <button type="button" className={styles.workerHead} aria-pressed={chosen === selectionId(node)} onClick={() => onSelect(node)}>
        <strong>{n.name}</strong>
        <span className={styles.line}>{nodeLine(m, n, time)}</span>
        {why.reason && <span className={styles.hold}>{`holding: ${why.reason}`}</span>}
        {over > 0 && <span className={styles.hold}>{overText(m, n)}</span>}
      </button>
      {cards.length > 0 && <ul className={styles.tiles} aria-label={`${n.name} slots`}>
        {cards.map(card => <Slot key={card.kind === "agent" ? `agent:${card.agent.sessionId}` : `${card.kind}:${card.index}`} n={n} card={card} time={time} chosen={chosen} onSelect={onSelect} />)}
      </ul>}
    </section>
  );
}

/** One slot of a worker node: "Slot k", and the attempt that holds it or that it is free. */
function Slot({ n, card, time, chosen, onSelect }: { n: NodeView; card: NodeSlot } & Drawn) {
  const label = card.slot === null ? NO_SLOT : `Slot ${card.slot}`;
  if (card.kind === "free") {
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
  const a: AgentView | null = card.kind === "agent" ? card.agent : null;
  const phase = a ? agentState(a) : "held";
  const selection: Selection = a ? { kind: "agent", sessionId: a.sessionId } : { kind: "held", nodeId: n.id, index: (card as Extract<NodeSlot, { kind: "held" }>).index };
  const title = a ? taskLabel(a) : SLOT_LABEL.held, lines = a ? agentLines(a) : null;
  const elapsed = a ? clock(time, a.startedAt) : null;
  const output = a && phase === "running" ? outputActivity(time, a.lastOutputAt) : null;
  // The tile's name is its slot, its worker's name and its phase, then its text. The clock and the output age are drawn
  // by CSS from attributes (as the tree's meters are), so the name does not change every second.
  const held = "An attempt holds this slot; no agent is listed yet";
  const facts = a ? [title, lines!.who, lines!.what].filter(Boolean).join(", ") : held;
  // The words the tile draws, in order, so the name contains what is seen.
  const drawn = a ? [title, lines!.who, [SLOT_LABEL[phase], lines!.what].filter(Boolean).join(" · ")].filter(Boolean).join(" ") : `${title} ${held}`;
  return (
    <li className={styles.cell} data-state={phase} data-class={a?.intelligenceClass ?? "none"} data-output={output?.state} data-over={(card.slot === null && phase !== "stopped") || undefined}>
      <button type="button" className={styles.tile} aria-pressed={chosen === selectionId(selection)} title={`${n.name}: ${a ? facts : HELD_TEXT}`} aria-label={`${label}, ${n.name}, ${SLOT_LABEL[phase].toLowerCase()}: ${drawn}`} onClick={() => onSelect(selection)}>
        <span className={styles.head} aria-hidden="true">
          {/* Drawn by CSS from attributes, as the clock is: the tile's name already starts with its slot. */}
          <span className={styles.name} data-label={label} />
          {elapsed && <span className={styles.clock} data-clock={elapsed} />}
        </span>
        <span className={styles.top}><i className={styles.dot} aria-hidden="true" /><span className={styles.title} data-part="title">{title}</span></span>
        {/* The spaces keep the words apart in the tile's name; the spans are blocks on screen. */}
        {lines ? <>
          {" "}<span className={styles.meta}>{lines.who}</span>
          {" "}<span className={styles.meta}>
            <span className={styles.phase}>{SLOT_LABEL[phase]}</span>
            {lines.what && ` · ${lines.what}`}
            {output && <span className={styles.output} data-output-age={` · output ${formatAge(time, a!.lastOutputAt!)}`} aria-hidden="true" />}
          </span>
        </> : <>{" "}<span className={styles.meta}>{held}</span></>}
      </button>
    </li>
  );
}
