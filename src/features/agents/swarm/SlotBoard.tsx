import type { MachineView, NodeView, SwarmView } from "../../../api/adapters/swarm";
import { formatAge } from "../../../components/time/relative";
import { useServerNow, type ServerAnchor } from "../../../components/time/useServerNow";
import { HELD_TEXT, selectionId, type Selection } from "./graph";
import { SLOT_LABEL, agentLines, agentState, clock, holdingNodes, machineShare, machineSlots, modelLabel, outputActivity, phaseParts, plural, shownMachineState, taskLabel, workerCounts, workerHeadline, workerTile, type WorkerTile } from "./slots";
import styles from "./SlotBoard.module.css";

export type SwarmViewMode = "tree" | "board";
type Tick = { now?: () => number };

/**
 * The count line above the tree and above the board, the same for both: real slots busy of real slots on how many
 * workers (a machine's worker service), in which phase, each machine's share, and what runs by model. One count
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
 * Every node as one tile, grouped by machine: readable at a distance and without zooming. A tile is called a slot of
 * its machine's worker, numbered in the order the read lists the machine's nodes; the node's own name is the tile's
 * tooltip and part of its accessible name. A busy tile is the same object as the tree's agent card and selects the same
 * properties pane; any other tile selects its node.
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
      const { slots, busy } = machineSlots(m);
      const load = m.load ? ` · CPU ${m.load.cpuPercent}% · RAM ${m.load.memoryPercent}%${m.load.fresh ? "" : " (stale)"}` : "";
      return `${busy} of ${plural(slots, "slot")} busy${load}`;
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
      {m.nodes.length > 0 && <ul className={styles.tiles} aria-label={`${m.label} slots`}>
        {m.nodes.map((n, i) => <Worker key={n.id} slot={i + 1} tile={workerTile(m, n)} lastSeenAt={n.lastSeenAt ?? m.lastSeenAt} time={time} chosen={chosen} onSelect={onSelect} />)}
      </ul>}
    </div>
  );
}

export { agentLines };

const STANDING_LABEL: Record<NonNullable<WorkerTile["standing"]>, string> = {
  holding: "holding", draining: "draining", stopped: "stopped", offline: "offline", booting: "booting", revoked: "revoked", unknown: "state unknown",
};
/** What else a slot holds besides the attempt its tile shows, one per line. */
export function othersText(t: WorkerTile): string {
  const named = t.others.map(a => `${taskLabel(a)} (${[SLOT_LABEL[agentState(a)].toLowerCase(), a.manual ? "interactive" : null, modelLabel(a)].filter(Boolean).join(", ")})`);
  return [...named, ...(t.heldMore > 0 ? [`${t.heldMore} more starting or settling`] : [])].join("\n");
}

function More({ tile }: { tile: WorkerTile }) {
  const more = tile.others.length + tile.heldMore;
  if (more === 0) return null;
  const text = othersText(tile);
  return <span className={styles.more} title={text}>{`+${more}`}<span className="visually-hidden">{` more on this slot: ${text.replaceAll("\n", "; ")}`}</span></span>;
}

function Worker({ slot, tile, lastSeenAt, time, chosen, onSelect }: { /** The tile's 1-based place under its machine. */ slot: number; tile: WorkerTile; lastSeenAt: string | null } & Drawn) {
  const n: NodeView = tile.node, a = tile.agent;
  const node: Selection = { kind: "node", nodeId: n.id };
  const label = `Slot ${slot}`, named = `${label}, ${n.name}`;
  if (tile.state !== "busy") {
    // Not busy: one calm tile that says so, or says why the slot takes no work, and selects its node.
    const why = tile.reason ?? (tile.state === "offline" && lastSeenAt ? `last seen ${formatAge(time, lastSeenAt)}` : null);
    const standing = tile.state === "idle" ? "idle" : STANDING_LABEL[tile.state];
    return (
      <li className={styles.cell} data-state={tile.state}>
        <button type="button" className={styles.tile} aria-pressed={chosen === selectionId(node)} title={n.name} aria-label={`${[label, standing, why].filter(Boolean).join(" ")}, ${n.name}`} onClick={() => onSelect(node)}>
          {/* The tile reads "Slot 4 · idle"; its name is the words drawn ("Slot 4 idle"), then its node's name. */}
          <span className={styles.name}>{label}</span>
          <span className="visually-hidden">{" ·"}</span>{" "}<span className={styles.standing}>{standing}</span>
          {why && <>{" "}<span className={styles.meta}>{why}</span></>}
        </button>
        <span className={styles.corner}><More tile={tile} /></span>
      </li>
    );
  }
  const phase = tile.phase!;
  const selection: Selection = a ? { kind: "agent", sessionId: a.sessionId } : { kind: "held", nodeId: n.id, index: 0 };
  const title = a ? taskLabel(a) : SLOT_LABEL.held, lines = a ? agentLines(a) : null;
  const elapsed = a ? clock(time, a.startedAt) : null;
  const output = a && phase === "running" ? outputActivity(time, a.lastOutputAt) : null;
  // The tile's name is its slot, its node's name and its phase (not drawn: the slot is the label above), then its text. The clock and the output age are drawn by CSS
  // from attributes (as the tree's meters are), so the name does not change every second.
  const held = "An attempt holds this slot; no agent is listed yet";
  const facts = a ? [title, lines!.who, lines!.what].filter(Boolean).join(", ") : held;
  // The words the tile draws, in order, so the name contains what is seen.
  const drawn = a ? [title, lines!.who, [SLOT_LABEL[phase], lines!.what].filter(Boolean).join(" · ")].filter(Boolean).join(" ") : `${title} ${held}`;
  return (
    <li className={styles.cell} data-state={phase} data-class={a?.intelligenceClass ?? "none"} data-output={output?.state}>
      <div className={styles.head}>
        <button type="button" className={styles.name} aria-pressed={chosen === selectionId(node)} title={n.name} aria-label={named} onClick={() => onSelect(node)}>{label}</button>
        {tile.standing && <span className={styles.also} title={tile.reason ?? undefined}>{STANDING_LABEL[tile.standing]}</span>}
        <More tile={tile} />
        {elapsed && <span className={styles.clock} data-clock={elapsed} aria-hidden="true" />}
      </div>
      <button type="button" className={styles.tile} aria-pressed={chosen === selectionId(selection)} title={`${n.name}: ${a ? facts : HELD_TEXT}`} aria-label={`${named}, ${SLOT_LABEL[phase].toLowerCase()}: ${drawn}`} onClick={() => onSelect(selection)}>
        <span className={styles.top}><i className={styles.dot} aria-hidden="true" /><span className={styles.title}>{title}</span></span>
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
