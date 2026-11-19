import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { Link, type To } from "react-router";
import { ArrowRight, Minus, Plus, RotateCcw } from "lucide-react";
import { ActionButton } from "../../../components/layout/Workspace";
import { useMediaQuery } from "../../../components/useMediaQuery";
import { TASK_STATUS_LABEL } from "../labels";
import { StatusIcon } from "../StatusIcon";
import type { GanttLayout, PositionedTask } from "./ganttLayout";
import { AXIS_INSET, POINT_WIDTH, RULER_HEIGHT, barStart, barWidth, dependencyPaths, plotPoint } from "./ganttConnectors";
import styles from "./Gantt.module.css";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 1.75;
const ZOOM_STEP = 0.125;
const PAN = 58;

type Drag = { id: number; x: number; y: number; left: number; top: number; moved: boolean };
const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
export function GanttCanvas({ layout, compact, fullView, selected, linkTo }: {
  layout: GanttLayout; compact: boolean; fullView?: ReactNode; selected?: string; linkTo: (task: PositionedTask) => To;
}) {
  const uid = useId().replace(/[^a-z0-9_-]/gi, "");
  const viewport = useRef<HTMLDivElement>(null);
  const axis = useRef<HTMLSpanElement>(null);
  const prior = useRef<GanttLayout | null>(null);
  const seenSelection = useRef<string | undefined>(undefined);
  const zoomAt = useRef<{ point: number; original: number } | null>(null);
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const [zoom, setZoom] = useState(1);
  const [visible, setVisible] = useState({ left: 0, width: 0 });
  const [active, setActive] = useState<string>();
  const touch = useMediaQuery("(pointer: coarse)");
  const rowHeight = touch ? 44 : 34;
  const width = plotPoint(layout.totalPoints, zoom) + 30;
  const unit = POINT_WIDTH * zoom;
  const interval = unit < 30 ? 2 : 1;
  const firstTick = Math.max(0, Math.floor((visible.left - AXIS_INSET) / (unit * interval)) * interval);
  const lastTick = Math.min(layout.totalPoints, Math.ceil((visible.left + visible.width) / (unit * interval)) * interval);
  const ticks = Array.from({ length: Math.max(0, Math.floor((lastTick - firstTick) / interval) + 1) }, (_, i) => firstTick + i * interval);
  const height = layout.rowCount * rowHeight;
  const rows = [...layout.groups, ...layout.tasks].sort((a, b) => a.row - b.row);
  const paths = useMemo(() => dependencyPaths(layout.edges, rowHeight, zoom), [layout.edges, rowHeight, zoom]);
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
  const connections = new Map<string, { prerequisites: string[]; dependents: string[] }>();
  for (const task of layout.tasks) connections.set(task.key, { prerequisites: [], dependents: [] });
  for (const edge of layout.edges) {
    connections.get(edge.target.key)!.prerequisites.push(edge.source.title);
    connections.get(edge.source.key)!.dependents.push(edge.target.title);
  }

  function measureViewport() {
    const el = viewport.current;
    if (!el) return;
    const left = el.scrollLeft;
    const width = el.clientWidth - (axis.current?.offsetWidth ?? 0);
    setVisible(current => current.left === left && current.width === width ? current : { left, width });
  }

  useLayoutEffect(() => {
    measureViewport();
    if (typeof ResizeObserver === "undefined" || !viewport.current) return;
    const observer = new ResizeObserver(measureViewport);
    observer.observe(viewport.current);
    if (axis.current) observer.observe(axis.current);
    return () => observer.disconnect();
  }, []);

  function zoomTo(next: number, clientX?: number) {
    const el = viewport.current;
    const scale = clampZoom(next);
    if (!el || scale === zoom) return;
    const railWidth = axis.current?.offsetWidth ?? 0;
    const point = clientX === undefined ? (el.clientWidth - railWidth) / 2 : Math.max(0, clientX - railWidth);
    zoomAt.current = { point, original: (el.scrollLeft + point - AXIS_INSET) / zoom };
    setZoom(scale);
  }

  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    function wheel(event: WheelEvent) {
      const target = viewport.current;
      if (!target) return;
      const x = event.clientX - target.getBoundingClientRect().left;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        zoomTo(zoom - Math.sign(event.deltaY) * ZOOM_STEP, x);
        return;
      }
      // Preserve native two-axis trackpad movement and vertical scrolling over task names.
      if (event.deltaX || (!event.shiftKey && x < (axis.current?.offsetWidth ?? 0))) return;
      const scale = event.deltaMode === 1 ? 18 : event.deltaMode === 2 ? target.clientWidth : 1;
      const before = target.scrollLeft;
      target.scrollLeft += event.deltaY * scale;
      if (before !== target.scrollLeft) event.preventDefault();
    }
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [zoom]);

  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const plotWidth = el.clientWidth - (axis.current?.offsetWidth ?? 0);
    if (zoomAt.current) {
      const { point, original } = zoomAt.current;
      zoomAt.current = null;
      el.scrollLeft = original * zoom + AXIS_INSET - point;
    } else if (prior.current && prior.current !== layout && (el.scrollLeft || el.scrollTop) && !drag.current) {
      const positions = new Map(layout.tasks.map(task => [task.key, task]));
      const anchor = prior.current.tasks.find(task => {
        const x = barStart(task, zoom), y = task.row * rowHeight;
        return positions.has(task.key) && x + barWidth(task, zoom) > el.scrollLeft && x < el.scrollLeft + plotWidth
          && y + rowHeight > el.scrollTop && y < el.scrollTop + el.clientHeight - RULER_HEIGHT;
      });
      if (anchor) {
        const next = positions.get(anchor.key)!;
        if (el.scrollLeft > 0) el.scrollLeft += (next.start - anchor.start) * unit;
        if (el.scrollTop > 0) el.scrollTop += (next.row - anchor.row) * rowHeight;
      }
    }
    prior.current = layout;
    if (!selected) seenSelection.current = undefined;
    if (selection && seenSelection.current !== selected) {
      const x = barStart(selection, zoom), y = selection.row * rowHeight;
      if (x < el.scrollLeft || x + barWidth(selection, zoom) > el.scrollLeft + plotWidth) el.scrollLeft = x - 8;
      if (y < el.scrollTop || y + rowHeight > el.scrollTop + el.clientHeight - RULER_HEIGHT) el.scrollTop = y;
      seenSelection.current = selected;
    }
    measureViewport();
  }, [layout, rowHeight, selected, selection, unit, zoom]);

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    suppressClick.current = false;
    if (event.pointerType === "touch" || event.button !== 0) return;
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
    suppressClick.current = drag.current.moved;
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
    <div className={styles.viewport} ref={viewport} style={{
      "--plot-width": `${width}px`, "--step-width": `${unit * interval}px`, "--plot-inset": `${AXIS_INSET}px`, "--row-height": `${rowHeight}px`, "--ruler-height": `${RULER_HEIGHT}px`,
    } as CSSProperties} role="region" aria-label="Scrollable dependency tracks" tabIndex={0} aria-describedby={`${uid}-keys`}
      onKeyDown={handleKey} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={stopDrag} onPointerCancel={stopDrag}
      onLostPointerCapture={stopDrag} onPointerLeave={event => { if (!drag.current?.moved) stopDrag(event); }}
      onScroll={measureViewport} onClickCapture={event => {
        if (event.detail > 0 && suppressClick.current) {
          event.preventDefault();
          event.stopPropagation();
          suppressClick.current = false;
        }
      }}>
      <div className={styles.ruler}>
        <span className={styles.axisHeading} ref={axis}>Task</span>
        <div className={styles.plotRuler} aria-label="Story points" role="group">
          {ticks.map(points => <span key={points} className={styles.tick} style={{ left: plotPoint(points, zoom) }}>{points}</span>)}
        </div>
      </div>
      <div className={styles.plot}>
        <svg className={styles.edges} width={width} height={height} aria-hidden>
          <defs>
            <marker id={`${uid}-arrow`} viewBox="0 0 8 8" markerWidth="7" markerHeight="7" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0 L8 4 L0 8 Z" /></marker>
            <marker id={`${uid}-arrow-active`} viewBox="0 0 8 8" markerWidth="7" markerHeight="7" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path className={styles.activeArrow} d="M0 0 L8 4 L0 8 Z" /></marker>
          </defs>
          {layout.edges.map(edge => {
            const emphasized = emphasizedEdges.has(edge.id);
            return <path key={edge.id} data-gantt-dependency={edge.id} d={paths.get(edge.id)} data-highlight={emphasized || undefined}
              markerEnd={`url(#${uid}-arrow${emphasized ? "-active" : ""})`} />;
          })}
        </svg>
        {rows.map(task => {
          if (task.kind === "project") return <div key={task.id} className={styles.group}><span title={task.title}>{task.title}</span></div>;
          const label = TASK_STATUS_LABEL[task.status];
          const { prerequisites, dependents } = connections.get(task.key)!;
          const incoming = prerequisites.length, outgoing = dependents.length;
          const descriptionId = incoming || outgoing ? `${uid}-connections-${task.key}` : undefined;
          const details = [
            task.storyPoints === null ? "Unestimated" : `${task.storyPoints} story ${task.storyPoints === 1 ? "point" : "points"}`,
            incoming && `${incoming} ${incoming === 1 ? "prerequisite" : "prerequisites"}`,
            outgoing && `${outgoing} ${outgoing === 1 ? "dependent" : "dependents"}`,
          ].filter(Boolean).map(text => ` · ${text}`).join("");
          return <Link key={task.key} aria-describedby={descriptionId} to={linkTo(task)} preventScrollReset draggable={false} className={styles.task} aria-current={task.key === selection?.key ? "page" : undefined}
            title={`${task.title} · ${label}${details}`} data-status={task.status} data-root={task.start === 0 || undefined} data-unestimated={task.storyPoints === null || undefined}
            data-connected={connected.has(task.key) || undefined} data-task-id={task.id}
            onMouseEnter={() => setActive(task.key)} onMouseLeave={() => setActive(undefined)} onFocus={() => setActive(task.key)} onBlur={() => setActive(undefined)}>
            <span className={styles.taskLabel} data-gantt-label>
              <StatusIcon status={task.status} decorative size={14} />
              <span className={styles.taskTitle}>{task.title}</span>
              <span className={task.status === "running" ? styles.taskStatus : "visually-hidden"}> {label}</span>
              {details && <span className="visually-hidden">{details}</span>}
            </span>
            <span className={styles.barHitArea} data-gantt-bar aria-hidden style={{ marginInlineStart: barStart(task, zoom), width: barWidth(task, zoom) }}>
              <span className={styles.bar} />
            </span>
            {descriptionId && <span hidden id={descriptionId}>
              {incoming ? `Waits for ${prerequisites.join(", ")}. ` : ""}
              {outgoing ? `Blocks ${dependents.join(", ")}.` : ""}
            </span>}
          </Link>;
        })}
      </div>
    </div>
    <p id={`${uid}-keys`} className={styles.chartHint}>
      <strong>Story points.</strong> Scroll or drag across the chart to pan.
      {layout.tasks.some(task => task.storyPoints === null) && " Dashed bars use a one-point placeholder for unestimated tasks."}
      <span className="visually-hidden"> Arrow keys pan. Plus and minus zoom. Zero resets the zoom.</span>
    </p>
  </div>;
}
