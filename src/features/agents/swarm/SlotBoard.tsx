import type { AgentView, MachineView, NodeView, SwarmView } from "../../../api/adapters/swarm";
import { formatAge } from "../../../components/time/relative";
import { useServerNow, type ServerAnchor } from "../../../components/time/useServerNow";
import { HELD_TEXT, selectionId, type Selection } from "./graph";
import { SLOT_LABEL, agentState, clock, detailParts, headline, levelLabel, modelLabel, occupied, outputActivity, phaseParts, swarmCounts, taskLabel, workerCounts, workerHeadline, workerTile, type SwarmCounts, type WorkerCounts, type WorkerTile } from "./slots";
import styles from "./SlotBoard.module.css";

export type SwarmViewMode = "tree" | "board";
type Tick = { now?: () => number };

/**
 * The count line above the tree or the board. Above the board it counts workers, since a worker runs one queued task at
 * a time: how many are busy on how many machines, in which phase, each machine's share, and what runs by model. Above
 * the tree it counts the slots the tree draws. Counted from the rows the page draws. The age of the last update is
 * real: it restarts when a poll succeeds and keeps counting when one does not.
 */
export function SwarmSummary({ view, anchor, mode, onMode, stale = false, now }: { view: SwarmView; anchor: ServerAnchor | undefined; mode: SwarmViewMode; onMode(mode: SwarmViewMode): void; stale?: boolean } & Tick) {
  const time = useServerNow(anchor, { tickMs: 1000, ...(now ? { now } : {}) });
  const counts = swarmCounts(view);
  const workers = mode === "board" ? workerCounts(view) : null;
  return (
    <section className={styles.summary} aria-label="Swarm activity" data-stale={stale || undefined} data-mode={mode}>
      <p className={styles.headline} role="status">
        <strong>{workers ? workerHeadline(workers) : headline(counts)}</strong>
        <span className={styles.rest}>{(workers ? phaseParts(workers) : detailParts(counts)).join(" · ")}</span>
      </p>
      <ul className={styles.machines} aria-label="Machines">
        {workers
          ? workers.machines.map(m => <li key={m.id} data-state={m.state} data-busy={m.busy > 0 || undefined}>{workerChip(m)}</li>)
          : counts.machines.map(m => <li key={m.id} data-state={m.state} data-busy={m.running > 0 || undefined}>{machineChip(m)}</li>)}
      </ul>
      <span className={styles.updated} data-stale={stale || undefined}>{stale ? "Not updating" : time ? `Updated ${formatAge(time, view.serverTime)}` : ""}</span>
      <div className={styles.modes} role="group" aria-label="Swarm view">
        {(["tree", "board"] as const).map(m => <button key={m} type="button" aria-pressed={mode === m} onClick={() => onMode(m)}>{m === "tree" ? "Tree" : "Board"}</button>)}
      </div>
      {workers && workers.models.length > 0 && <ul className={styles.models} aria-label="Models running now">
        {workers.models.map(m => <li key={m.model} data-class={m.cls ?? "none"}><i aria-hidden="true" />{`${m.model} ×${m.count}`}</li>)}
      </ul>}
    </section>
  );
}

function machineChip(m: SwarmCounts["machines"][number]): string {
  if (!m.live) return `${m.label}: ${m.state}`;
  const slots = m.total === null ? `${occupied(m)} busy` : `${occupied(m)}/${m.total} slots`;
  return `${m.label}: ${m.running} running · ${slots}${m.state === "holding" ? " · holding" : ""}`;
}
function workerChip(m: WorkerCounts["machines"][number]): string {
  if (!m.live) return `${m.label}: ${m.state}`;
  return `${m.label}: ${m.busy} of ${m.workers} busy${m.state === "holding" ? " · holding" : ""}`;
}

/**
 * Every worker as one tile, grouped by machine: readable at a distance and without zooming. A busy tile is the same
 * object as the tree's agent card and selects the same properties pane; any other tile selects its worker.
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
      const busy = m.nodes.filter(n => workerTile(m, n).state === "busy").length;
      const load = m.load ? ` · CPU ${m.load.cpuPercent}% · RAM ${m.load.memoryPercent}%${m.load.fresh ? "" : " (stale)"}` : "";
      return `${busy} of ${m.nodes.length} ${m.nodes.length === 1 ? "worker" : "workers"} busy${load}`;
    }
  }
}

type Drawn = { time: string; chosen: string | null; onSelect(s: Selection): void };

function Machine({ m, time, chosen, onSelect }: { m: MachineView } & Drawn) {
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
      {m.nodes.length > 0 && <ul className={styles.tiles} aria-label={`${m.label} workers`}>
        {m.nodes.map(n => <Worker key={n.id} tile={workerTile(m, n)} lastSeenAt={n.lastSeenAt ?? m.lastSeenAt} time={time} chosen={chosen} onSelect={onSelect} />)}
      </ul>}
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

const STANDING_LABEL: Record<NonNullable<WorkerTile["standing"]>, string> = {
  holding: "holding", draining: "draining", stopped: "stopped", offline: "offline", booting: "booting", revoked: "revoked", unknown: "state unknown",
};
/** What else a worker holds besides the attempt its tile shows, one per line. */
export function othersText(t: WorkerTile): string {
  const named = t.others.map(a => `${taskLabel(a)} (${[SLOT_LABEL[agentState(a)].toLowerCase(), a.manual ? "interactive" : null, modelLabel(a)].filter(Boolean).join(", ")})`);
  return [...named, ...(t.heldMore > 0 ? [`${t.heldMore} more starting or settling`] : [])].join("\n");
}

function More({ tile }: { tile: WorkerTile }) {
  const more = tile.others.length + tile.heldMore;
  if (more === 0) return null;
  const text = othersText(tile);
  return <span className={styles.more} title={text}>{`+${more}`}<span className="visually-hidden">{` more on this worker: ${text.replaceAll("\n", "; ")}`}</span></span>;
}

function Worker({ tile, lastSeenAt, time, chosen, onSelect }: { tile: WorkerTile; lastSeenAt: string | null } & Drawn) {
  const n: NodeView = tile.node, a = tile.agent;
  const node: Selection = { kind: "node", nodeId: n.id };
  if (tile.state !== "busy") {
    // Not busy: one calm tile that says so, or says why the worker takes no work, and selects the worker.
    const why = tile.reason ?? (tile.state === "offline" && lastSeenAt ? `last seen ${formatAge(time, lastSeenAt)}` : null);
    return (
      <li className={styles.cell} data-state={tile.state}>
        <button type="button" className={styles.tile} aria-pressed={chosen === selectionId(node)} onClick={() => onSelect(node)}>
          <span className={styles.name}>{n.name}</span>
          {" "}<span className={styles.standing}>{tile.state === "idle" ? "idle" : STANDING_LABEL[tile.state]}</span>
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
  // The tile's name is its text. The clock and the output age are drawn by CSS from attributes (as the tree's meters
  // are), so the name does not change every second.
  return (
    <li className={styles.cell} data-state={phase} data-class={a?.intelligenceClass ?? "none"} data-output={output?.state}>
      <div className={styles.head}>
        <button type="button" className={styles.name} aria-pressed={chosen === selectionId(node)} onClick={() => onSelect(node)}>{n.name}</button>
        {tile.standing && <span className={styles.also} title={tile.reason ?? undefined}>{STANDING_LABEL[tile.standing]}</span>}
        <More tile={tile} />
        {elapsed && <span className={styles.clock} data-clock={elapsed} aria-hidden="true" />}
      </div>
      <button type="button" className={styles.tile} aria-pressed={chosen === selectionId(selection)} title={a ? [title, lines!.who, lines!.what].filter(Boolean).join(", ") : HELD_TEXT} onClick={() => onSelect(selection)}>
        <span className={styles.top}><i className={styles.dot} aria-hidden="true" /><span className={styles.title}>{title}</span></span>
        {/* The spaces keep the words apart in the tile's name; the spans are blocks on screen. */}
        {lines ? <>
          {" "}<span className={styles.meta}>{lines.who}</span>
          {" "}<span className={styles.meta}>
            <span className={styles.phase}>{SLOT_LABEL[phase]}</span>
            {lines.what && ` · ${lines.what}`}
            {output && <span className={styles.output} data-output-age={` · output ${formatAge(time, a!.lastOutputAt!)}`} aria-hidden="true" />}
          </span>
        </> : <>{" "}<span className={styles.meta}>An attempt holds this worker; no agent is listed yet</span></>}
      </button>
    </li>
  );
}
