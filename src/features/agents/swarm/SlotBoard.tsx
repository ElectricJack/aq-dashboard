import { Slot, slotKey, type Drawn } from "./SlotTile";
import type { CSSProperties } from "react";
import type { MachineView, NodeView, SwarmView } from "../../../api/adapters/swarm";
import { formatAge } from "../../../components/time/relative";
import { useServerNow, type ServerAnchor } from "../../../components/time/useServerNow";
import { nodeLine, overText, selectionId, type Selection } from "./graph";
import { agentLines, busyOnWorkers, holdingNodes, machineShare, machineSlots, nodeSlots, nodeStanding, overSlots, phaseParts, shownMachineState, workerCounts, workerHeadline } from "./slots";
import styles from "./SlotBoard.module.css";

export type SwarmViewMode = "tree" | "board";
type Tick = { now?: () => number };

function useSwarmTime(anchor: ServerAnchor | undefined, now: Tick["now"]) {
  return useServerNow(anchor, { tickMs: 1000, ...(now ? { now } : {}) });
}

function updatedAt(stale: boolean, time: string | null, serverTime: string) {
  if (stale) return "Not updating";
  return time ? `Updated ${formatAge(time, serverTime)}` : "";
}

/**
 * The count line above the tree and above the board, the same for both: slots busy of all slots on how many workers
 * (a worker is a worker node), in which phase, each machine's share, and what runs by model. One count
 * (`workerCounts`) feeds it, from the rows the page draws. The age of the last update is real: it restarts when a poll
 * succeeds and keeps counting when one does not.
 */
export function SwarmSummary({ view, anchor, mode, onMode, stale = false, now }: { view: SwarmView; anchor: ServerAnchor | undefined; mode: SwarmViewMode; onMode(mode: SwarmViewMode): void; stale?: boolean } & Tick) {
  const time = useSwarmTime(anchor, now);
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
      <span className={styles.updated} data-stale={stale || undefined}>{updatedAt(stale, time, view.serverTime)}</span>
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
  const time = useSwarmTime(anchor, now);
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

/** A worker node: its name with how many of its slots are busy (or what it is doing instead), then one tile per slot. */
function Worker({ m, n, time, chosen, onSelect }: { m: MachineView; n: NodeView } & Drawn) {
  const node: Selection = { kind: "node", nodeId: n.id };
  const why = nodeStanding(m, n), cards = nodeSlots(m, n), over = overSlots(m, n);
  return (
    <section className={styles.worker} aria-label={n.name} data-state={why.standing} data-over={over > 0 || undefined} style={{ "--across": Math.max(1, Math.min(4, cards.length)) } as CSSProperties}>
      <button type="button" className={styles.workerHead} aria-pressed={chosen === selectionId(node)} onClick={() => onSelect(node)}>
        <strong>{n.name}</strong>
        <span className={styles.line}>{nodeLine(m, n, time)}</span>
        {why.reason && <span className={styles.hold}>{`holding: ${why.reason}`}</span>}
        {over > 0 && <span className={styles.hold}>{overText(m, n)}</span>}
      </button>
      {cards.length > 0 && <ul className={styles.tiles} aria-label={`${n.name} slots`}>
        {cards.map(card => <Slot key={slotKey(card)} n={n} card={card} time={time} chosen={chosen} onSelect={onSelect} />)}
      </ul>}
    </section>
  );
}

/** One slot of a worker node: "Slot k", and the attempt that holds it or that it is free. */
