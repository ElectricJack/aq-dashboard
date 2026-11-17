import type { AgentView, MachineView, NodeView, SwarmView } from "../../../api/adapters/swarm";
import { formatAge } from "../../../components/time/relative";
import { useServerNow, type ServerAnchor } from "../../../components/time/useServerNow";
import { HELD_TEXT, selectionId, type Selection } from "./graph";
import { SLOT_LABEL, clock, detailParts, drawsSlots, headline, levelLabel, nodeCounts, nodeSlots, occupied, outputActivity, swarmCounts, taskLabel, type Slot, type SwarmCounts } from "./slots";
import styles from "./SlotBoard.module.css";

export type SwarmViewMode = "tree" | "board";
type Tick = { now?: () => number };

/**
 * The count line above the tree or the board: how many agents run on how many machines, what else holds a slot, and
 * each machine's share. Counted from the rows the page draws. The age of the last update is real: it restarts when a
 * poll succeeds and keeps counting when one does not.
 */
export function SwarmSummary({ view, anchor, mode, onMode, stale = false, now }: { view: SwarmView; anchor: ServerAnchor | undefined; mode: SwarmViewMode; onMode(mode: SwarmViewMode): void; stale?: boolean } & Tick) {
  const time = useServerNow(anchor, { tickMs: 1000, ...(now ? { now } : {}) });
  const counts = swarmCounts(view);
  return (
    <section className={styles.summary} aria-label="Swarm activity" data-stale={stale || undefined}>
      <p className={styles.headline} role="status">
        <strong>{headline(counts)}</strong>
        <span className={styles.rest}>{detailParts(counts).join(" · ")}</span>
      </p>
      <ul className={styles.machines} aria-label="Machines">
        {counts.machines.map(m => <li key={m.id} data-state={m.state} data-busy={m.running > 0 || undefined}>{machineChip(m)}</li>)}
      </ul>
      <span className={styles.updated} data-stale={stale || undefined}>{stale ? "Not updating" : time ? `Updated ${formatAge(time, view.serverTime)}` : ""}</span>
      <div className={styles.modes} role="group" aria-label="Swarm view">
        {(["tree", "board"] as const).map(m => <button key={m} type="button" aria-pressed={mode === m} onClick={() => onMode(m)}>{m === "tree" ? "Tree" : "Board"}</button>)}
      </div>
    </section>
  );
}

function machineChip(m: SwarmCounts["machines"][number]): string {
  if (!m.live) return `${m.label}: ${m.state}`;
  const slots = m.total === null ? `${occupied(m)} busy` : `${occupied(m)}/${m.total} slots`;
  return `${m.label}: ${m.running} running · ${slots}${m.state === "holding" ? " · holding" : ""}`;
}

/**
 * Every slot of every worker as a tile, grouped by machine: readable at a distance and without zooming. A tile is the
 * same object as the tree's card and selects the same properties pane.
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
  switch (m.state) {
    case "offline": return m.lastSeenAt ? `offline · last seen ${formatAge(time, m.lastSeenAt)}` : "offline";
    case "stopped": return "stopped";
    case "booting": return "booting";
    default: {
      const c = m.nodes.reduce((sum, n) => { const x = nodeCounts(n); return { running: sum.running + x.running, busy: sum.busy + occupied(x) }; }, { running: 0, busy: 0 });
      const load = m.load ? ` · CPU ${m.load.cpuPercent}% · RAM ${m.load.memoryPercent}%${m.load.fresh ? "" : " (stale)"}` : "";
      return `${c.running} running · ${c.busy}${m.agentMax === null ? "" : `/${m.agentMax}`} slots busy${load}`;
    }
  }
}

function Machine({ m, time, chosen, onSelect }: { m: MachineView; time: string; chosen: string | null; onSelect(s: Selection): void }) {
  const selection: Selection = { kind: "machine", machineId: m.id };
  const hold = m.state === "holding" ? m.holding[0] : undefined;
  return (
    <div className={styles.machine} data-state={m.state}>
      <button type="button" className={styles.machineHead} aria-pressed={chosen === selectionId(selection)} onClick={() => onSelect(selection)}>
        <strong>{m.label}</strong>
        <span className={styles.state} data-state={m.state}>{m.state === "unknown" ? "state unknown" : m.state}</span>
        <span className={styles.line}>{machineLine(m, time)}</span>
        {hold && <span className={styles.hold}>{`holding: ${hold.message}`}</span>}
      </button>
      {drawsSlots(m) && m.nodes.map(n => <Worker key={n.id} n={n} time={time} chosen={chosen} onSelect={onSelect} />)}
    </div>
  );
}

function Worker({ n, time, chosen, onSelect }: { n: NodeView; time: string; chosen: string | null; onSelect(s: Selection): void }) {
  const selection: Selection = { kind: "node", nodeId: n.id };
  const c = nodeCounts(n);
  const slots = n.slots.total === null ? "capacity not reported" : `${occupied(c)}/${n.slots.total} slots`;
  return (
    <div className={styles.worker} data-health={n.health}>
      <button type="button" className={styles.workerHead} aria-pressed={chosen === selectionId(selection)} onClick={() => onSelect(selection)}>
        <strong>{n.name}</strong>
        <span className={styles.line}>{n.health === "online" ? slots : `${n.health} · ${slots}`}</span>
        {n.holding[0] && <span className={styles.hold}>{n.holding[0].message}</span>}
      </button>
      {/* One list per worker: occupied slots as tiles, then free ones as small chips on their own row. */}
      <ul className={styles.tiles} aria-label={`${n.name} slots`}>
        {nodeSlots(n).map(slot => <li key={slot.key} data-free={slot.state === "free" || undefined}><Tile slot={slot} nodeId={n.id} time={time} chosen={chosen} onSelect={onSelect} /></li>)}
      </ul>
    </div>
  );
}

/** Project, role and level; then model and effort. Only what the read (or the task's own read) gave. */
export function agentLines(a: AgentView): { who: string; what: string } {
  const level = levelLabel(a);
  const model = a.ranWith?.model ?? a.model;
  const effort = a.ranWith?.reasoning ?? a.manual?.spec.reasoning;
  return {
    who: [a.project.label, a.ranWith?.role, level].filter(Boolean).join(" · "),
    what: [model ?? a.harness ?? a.provider, effort ? `${effort} effort` : null].filter(Boolean).join(" · "),
  };
}

function Tile({ slot, nodeId, time, chosen, onSelect }: { slot: Slot; nodeId: string; time: string; chosen: string | null; onSelect(s: Selection): void }) {
  const a = slot.agent;
  if (!a) {
    // The key ends in the slot's index among its kind, the index the tree's card of the same slot has.
    const index = Number(slot.key.split(":").pop());
    const selection: Selection = slot.state === "held" ? { kind: "held", nodeId, index } : { kind: "free", nodeId, index };
    const held = slot.state === "held";
    const label = held ? SLOT_LABEL.held : slot.more ? `+${slot.more} free` : "free";
    return (
      <button type="button" className={styles.tile} data-state={slot.state} aria-pressed={chosen === selectionId(selection)} title={held ? HELD_TEXT : undefined} onClick={() => onSelect(selection)}>
        <span className={styles.top}><i className={styles.dot} aria-hidden="true" /><span className={styles.title}>{label}</span></span>
        {held && <>{" "}<span className={styles.meta}>An attempt holds this slot; no agent is listed yet</span></>}
      </button>
    );
  }
  const selection: Selection = { kind: "agent", sessionId: a.sessionId };
  const title = taskLabel(a), lines = agentLines(a);
  const elapsed = slot.state === "stopped" ? null : clock(time, a.startedAt);
  const output = slot.state === "running" ? outputActivity(time, a.lastOutputAt) : null;
  const facts = [title, lines.who, lines.what].filter(Boolean).join(", ");
  // The tile's name is its text. The clock and the output age are drawn by CSS from attributes (as the tree's meters
  // are), so the name does not change every second.
  return (
    <button type="button" className={styles.tile} data-state={slot.state} data-class={a.intelligenceClass ?? "none"} data-output={output?.state} aria-pressed={chosen === selectionId(selection)}
      title={facts} onClick={() => onSelect(selection)}>
      <span className={styles.top}>
        <i className={styles.dot} aria-hidden="true" />
        <span className={styles.title}>{title}</span>
        {elapsed && <span className={styles.clock} data-clock={elapsed} aria-hidden="true" />}
      </span>
      {/* The spaces keep the words apart in the tile's name; the spans are blocks on screen. */}
      {" "}<span className={styles.meta}>{lines.who}</span>
      {" "}<span className={styles.meta}>
        <span className={styles.phase}>{SLOT_LABEL[slot.state]}</span>
        {lines.what && ` · ${lines.what}`}
        {output && <span className={styles.output} data-output-age={` · output ${formatAge(time, a.lastOutputAt!)}`} aria-hidden="true" />}
      </span>
    </button>
  );
}
