import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { Link, type To } from "react-router";
import { ArrowRight, Minus, Plus, RotateCcw } from "lucide-react";
import { ActionButton } from "../../../components/layout/Workspace";
import { useMediaQuery } from "../../../components/useMediaQuery";
import { TASK_STATUS_LABEL } from "../labels";
import { StatusIcon } from "../StatusIcon";
import type { GanttLayout, PositionedTask } from "./ganttLayout";
import styles from "./Gantt.module.css";

const COLUMN = 234;
const GAP = 32;
const LABEL_HEIGHT = 30;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 1.75;
const ZOOM_STEP = 0.125;
const PAN = 58;

type Drag = { id: number; x: number; y: number; left: number; top: number; moved: boolean };
type Point = { x: number; y: number };
const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
const xFor = (task: PositionedTask) => task.column * COLUMN + 8;

function edgePath(from: PositionedTask, to: PositionedTask, rowHeight: number) {
  const sy = (from.row + 0.5) * rowHeight;
  const ty = (to.row + 0.5) * rowHeight;
  const tx = xFor(to) - 2;
  const sx = xFor(from) + COLUMN - GAP;
  if (from.column === to.column) {
    const gutter = sx + 12;
    return `M ${sx} ${sy} H ${gutter} V ${ty - rowHeight / 2 + 2} H ${tx - 4} V ${ty} H ${tx}`;
  }
  if (to.column < from.column || to.column - from.column > 1) {
    const gutter = (from.row + 1) * rowHeight - 1;
    return `M ${sx} ${sy} H ${sx + 8} V ${gutter} H ${tx - 9} V ${ty} H ${tx}`;
  }
  const bend = tx - 9;
  return `M ${sx} ${sy} H ${bend} V ${ty} H ${tx}`;
}

export function GanttCanvas({ layout, compact, fullView, selected, linkTo }: {
  layout: GanttLayout; compact: boolean; fullView?: ReactNode; selected?: string; linkTo: (task: PositionedTask) => To;
}) {
  const uid = useId().replace(/[^a-z0-9_-]/gi, "");
  const viewport = useRef<HTMLDivElement>(null);
  const prior = useRef<GanttLayout | null>(null);
  const seenSelection = useRef<string | undefined>(undefined);
  const zoomAt = useRef<{ point: Point; original: Point } | null>(null);
  const drag = useRef<Drag | null>(null);
  const [zoom, setZoom] = useState(1);
  const [active, setActive] = useState<string>();
  const touch = useMediaQuery("(pointer: coarse)");
  const rowHeight = touch ? 56 : 36;
  const barHeight = touch ? 44 : 28;
  const width = layout.columnCount * COLUMN;
  const height = layout.rowCount * rowHeight;
  const selection = layout.tasks.find(task => task.id === selected);
  const highlighted = active ?? selection?.key;
  const emphasizedEdges = new Set<string>();
  const connected = new Set<string>();
  for (const edge of layout.edges) {
    if (edge.source.key !== highlighted && edge.target.key !== highlighted) continue;
    emphasizedEdges.add(edge.id);
    connected.add(edge.source.key);
    connected.add(edge.target.key);
  }
  const incoming = new Map<string, number>();
  for (const edge of layout.edges) incoming.set(edge.target.key, (incoming.get(edge.target.key) ?? 0) + 1);

  function zoomTo(next: number, anchor?: Point) {
    const el = viewport.current;
    const scale = clampZoom(next);
    if (!el || scale === zoom) return;
    const point = anchor ?? { x: el.clientWidth / 2, y: Math.max(0, el.clientHeight - LABEL_HEIGHT) / 2 };
    zoomAt.current = { point, original: { x: (el.scrollLeft + point.x) / zoom, y: (el.scrollTop + point.y) / zoom } };
    setZoom(scale);
  }

  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    function wheel(event: WheelEvent) {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      const bounds = el!.getBoundingClientRect();
      zoomTo(zoom - Math.sign(event.deltaY) * ZOOM_STEP, {
        x: event.clientX - bounds.left,
        y: Math.max(0, event.clientY - bounds.top - LABEL_HEIGHT),
      });
    }
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [zoom]);

  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    if (zoomAt.current) {
      const { point, original } = zoomAt.current;
      zoomAt.current = null;
      el.scrollLeft = original.x * zoom - point.x;
      el.scrollTop = original.y * zoom - point.y;
    } else if (prior.current && prior.current !== layout && (el.scrollLeft || el.scrollTop) && !drag.current) {
      const positions = new Map(layout.tasks.map(task => [task.key, task]));
      const anchor = prior.current.tasks.find(task => {
        const x = xFor(task) * zoom, y = task.row * rowHeight * zoom;
        return positions.has(task.key) && x + COLUMN * zoom > el.scrollLeft && x < el.scrollLeft + el.clientWidth
          && y + rowHeight * zoom > el.scrollTop && y < el.scrollTop + el.clientHeight - LABEL_HEIGHT;
      });
      if (anchor) {
        const next = positions.get(anchor.key)!;
        if (el.scrollLeft > 0) el.scrollLeft += (next.column - anchor.column) * COLUMN * zoom;
        if (el.scrollTop > 0) el.scrollTop += (next.row - anchor.row) * rowHeight * zoom;
      }
    }
    prior.current = layout;
    if (!selected) seenSelection.current = undefined;
    if (selection && seenSelection.current !== selected) {
      const x = xFor(selection) * zoom, y = selection.row * rowHeight * zoom;
      if (x < el.scrollLeft || x + (COLUMN - GAP) * zoom > el.scrollLeft + el.clientWidth) el.scrollLeft = x - 8;
      if (y < el.scrollTop || y + rowHeight * zoom > el.scrollTop + el.clientHeight - LABEL_HEIGHT) el.scrollTop = y;
      seenSelection.current = selected;
    }
  }, [layout, rowHeight, selected, selection, zoom]);

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "touch" || event.button !== 0 || (event.target as Element).closest("a,button")) return;
    const el = event.currentTarget;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: el.scrollLeft, top: el.scrollTop, moved: false };
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.x, dy = event.clientY - current.y;
    if (!current.moved && Math.hypot(dx, dy) < 5) return;
    const el = event.currentTarget;
    if (!current.moved) {
      current.moved = true;
      el.setPointerCapture(event.pointerId);
      el.dataset.dragging = "true";
    }
    el.scrollLeft = current.left - dx;
    el.scrollTop = current.top - dy;
  }

  function stopDrag(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerId !== drag.current?.id) return;
    drag.current = null;
    delete event.currentTarget.dataset.dragging;
  }

  function handleKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const el = event.currentTarget;
    switch (event.key) {
      case "ArrowLeft": el.scrollLeft -= PAN; break;
      case "ArrowRight": el.scrollLeft += PAN; break;
      case "ArrowUp": el.scrollTop -= PAN; break;
      case "ArrowDown": el.scrollTop += PAN; break;
      case "+": case "=": zoomTo(zoom + ZOOM_STEP); break;
      case "-": zoomTo(zoom - ZOOM_STEP); break;
      case "0": zoomTo(1); break;
      default: return;
    }
    event.preventDefault();
  }

  function goToStart() {
    const el = viewport.current;
    if (el) {
      el.scrollLeft = 0;
      el.scrollTop = 0;
    }
  }

  return <div className={styles.chart} data-compact={compact || undefined}>
    <div className={styles.toolbar}>
      <div className={styles.legend}>{fullView ?? <><ArrowRight size={14} aria-hidden /> <span>Prerequisite → dependent</span></>}</div>
      <div className={styles.controls} role="group" aria-label="Gantt controls">
        <ActionButton aria-label="Zoom out" onClick={() => zoomTo(zoom - ZOOM_STEP)} disabled={zoom <= MIN_ZOOM}><Minus size={16} aria-hidden /></ActionButton>
        <ActionButton aria-label={`Zoom ${Math.round(zoom * 100)}%. Reset zoom`} title="Reset zoom" onClick={() => zoomTo(1)}>{Math.round(zoom * 100)}%</ActionButton>
        <ActionButton aria-label="Zoom in" onClick={() => zoomTo(zoom + ZOOM_STEP)} disabled={zoom >= MAX_ZOOM}><Plus size={16} aria-hidden /></ActionButton>
        <ActionButton onClick={goToStart} aria-label="Return to start" title="Return to start"><RotateCcw size={15} aria-hidden /></ActionButton>
      </div>
    </div>
    <div className={styles.viewport} ref={viewport} role="region" aria-label="Scrollable dependency tracks" tabIndex={0} aria-describedby={`${uid}-keys`}
      onKeyDown={handleKey} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={stopDrag} onPointerCancel={stopDrag}
      onLostPointerCapture={stopDrag} onPointerLeave={event => { if (!drag.current?.moved) stopDrag(event); }}>
      <div className={styles.labels} style={{ width: width * zoom }}>
        {Array.from({ length: layout.columnCount }, (_, column) => <span key={column} style={{ width: COLUMN * zoom }}>
          {column === 0 ? "Front of track" : `Dependency step ${column}`}
        </span>)}
      </div>
      <div className={styles.sizer} style={{ width: width * zoom, height: height * zoom }}>
        <div className={styles.stage} data-zoom={zoom} style={{
          width, height, transform: `scale(${zoom})`,
          backgroundSize: `${COLUMN}px ${rowHeight}px`, backgroundPositionX: "-1px",
        }}>
          {layout.groups.map(group => <div key={group.id} className={styles.group} style={{ top: rowHeight * group.row, height: rowHeight }}>{group.title}</div>)}
          <svg className={styles.edges} width={width} height={height} aria-hidden>
            <defs><marker id={`${uid}-arrow`} viewBox="0 0 8 8" markerWidth="7" markerHeight="7" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z" /></marker>
              <marker id={`${uid}-arrow-active`} viewBox="0 0 8 8" markerWidth="7" markerHeight="7" refX="7" refY="4" orient="auto"><path className={styles.activeArrow} d="M0 0 L8 4 L0 8 Z" /></marker></defs>
            {layout.edges.map(edge => {
              const emphasized = emphasizedEdges.has(edge.id);
              return <path key={edge.id} d={edgePath(edge.source, edge.target, rowHeight)} data-highlight={emphasized || undefined}
                markerEnd={`url(#${uid}-arrow${emphasized ? "-active" : ""})`} />;
            })}
          </svg>
          {layout.tasks.map(task => {
            const label = TASK_STATUS_LABEL[task.status];
            const showStatus = task.status === "running" || task.status === "held" || task.status === "canceled";
            const blockers = incoming.get(task.key) ?? 0;
            const dependency = blockers ? ` · ${blockers} ${blockers === 1 ? "prerequisite" : "prerequisites"}` : "";
            return <Link key={task.key} to={linkTo(task)} preventScrollReset className={styles.task} aria-current={task.key === selection?.key ? "page" : undefined}
              title={`${task.title} · ${label}${dependency}`} data-status={task.status} data-connected={connected.has(task.key) || undefined}
              onMouseEnter={() => setActive(task.key)} onMouseLeave={() => setActive(undefined)} onFocus={() => setActive(task.key)} onBlur={() => setActive(undefined)}
              style={{ left: xFor(task), top: task.row * rowHeight + (rowHeight - barHeight) / 2, width: COLUMN - GAP, height: barHeight }}>
              <StatusIcon status={task.status} decorative size={14} /><span className={styles.taskTitle}>{task.title}</span>
              <span className={showStatus ? styles.taskStatus : "visually-hidden"}> {label}</span>
              {dependency && <span className="visually-hidden">{dependency}</span>}
            </Link>;
          })}
        </div>
      </div>
    </div>
    <p id={`${uid}-keys`} className="visually-hidden">Arrow keys pan the tracks. Plus and minus zoom. Zero resets the zoom.</p>
    {layout.edges.length > 0 && <details className={styles.relationships}>
      <summary>Dependencies ({layout.edges.length})</summary>
      <ul>{layout.edges.map(edge => <li key={edge.id}><Link to={linkTo(edge.source)}>{edge.source.title}</Link> must finish before <Link to={linkTo(edge.target)}>{edge.target.title}</Link></li>)}</ul>
    </details>}
  </div>;
}
