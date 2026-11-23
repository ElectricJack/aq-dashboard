import { useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import styles from "./Swarm.module.css";

type Stage = RefObject<HTMLDivElement | null>;
type SplitOptions = { stage: Stage; principal: string; enabled: boolean; desktop: boolean; focused: boolean; agent: boolean };
function readPercent(storageKey: string) {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored === null) return null;
    const percent = Number(stored);
    return percent >= 0 && percent <= 100 ? { key: storageKey, percent } : null;
  } catch { return null; }
}
function useStageWidth(stage: Stage, enabled: boolean) {
  const [stageWidth, setStageWidth] = useState(1000);
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const measure = () => { const width = element.getBoundingClientRect().width; if (width > 0) setStageWidth(width); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled, stage]);
  return stageWidth;
}
function useDragStyle(dragging: boolean) {
  useEffect(() => {
    if (!dragging) return;
    const previous = document.body.style.userSelect;
    const cursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    return () => { document.body.style.userSelect = previous; document.body.style.cursor = cursor; };
  }, [dragging]);
}
function splitBounds(stageWidth: number, agent: boolean) {
  const available = Math.max(1, stageWidth - 10);
  const minimum = Math.min(320, available / 2);
  const minPercent = minimum / available * 100;
  const maxPercent = 100 - minPercent;
  const defaultPercent = (available - (agent ? Math.min(720, available * .55) : 360)) / available * 100;
  return { minPercent, maxPercent, defaultPercent };
}
export function useSwarmSplit({ stage, principal, enabled, desktop, focused, agent }: SplitOptions) {
  const stageWidth = useStageWidth(stage, enabled);
  const storageKey = `aq.swarm.tree-width:${principal}`;
  const [preference, setPreference] = useState<ReturnType<typeof readPercent>>(null);
  const drag = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);
  useEffect(() => { setPreference(readPercent(storageKey)); }, [storageKey]);
  useDragStyle(dragging);
  const interactive = desktop && !focused;
  useEffect(() => { if (!interactive) finishDrag(); }, [interactive]);
  const { minPercent, maxPercent, defaultPercent } = splitBounds(stageWidth, agent);
  function clamp(percent: number) { return Math.max(minPercent, Math.min(maxPercent, percent)); }
  const treePercent = clamp(preference?.key === storageKey ? preference.percent : defaultPercent);
  const resize = (percent: number) => {
    const next = clamp(percent);
    setPreference({ key: storageKey, percent: next });
    try { localStorage.setItem(storageKey, String(next)); } catch { /* The split still works when storage is unavailable. */ }
  };
  function finishDrag() { drag.current = null; setDragging(false); }
  return { stage, dragging, drag, setDragging, finishDrag, resize, minPercent, maxPercent, treePercent, interactive };
}
type Split = ReturnType<typeof useSwarmSplit>;
function keyPercent(event: { key: string; shiftKey: boolean }, split: Split) {
  const step = event.shiftKey ? 10 : 2;
  const positions: Record<string, number> = {
    Home: split.minPercent, End: split.maxPercent,
    ArrowLeft: split.treePercent - step, ArrowRight: split.treePercent + step,
  };
  return Object.hasOwn(positions, event.key) ? positions[event.key]! : null;
}
function startDrag(event: PointerEvent<HTMLDivElement>, split: Split) {
  if (!split.interactive || event.button !== 0) return;
  event.preventDefault(); event.currentTarget.focus();
  event.currentTarget.setPointerCapture(event.pointerId);
  split.drag.current = event.pointerId; split.setDragging(true);
}
function moveDrag(event: PointerEvent<HTMLDivElement>, split: Split) {
  if (split.drag.current !== event.pointerId) return;
  const bounds = split.stage.current?.getBoundingClientRect();
  if (bounds && bounds.width > 10) split.resize((event.clientX - bounds.left - 5) / (bounds.width - 10) * 100);
}
export function SwarmDivider({ split }: { split: Split }) {
  const { minPercent, maxPercent, treePercent, resize, interactive, drag, finishDrag } = split;
  return <div className={styles.divider} role="separator" aria-label="Resize swarm tree and properties" aria-orientation="vertical"
        aria-valuemin={Math.round(minPercent)} aria-valuemax={Math.round(maxPercent)} aria-valuenow={Math.round(treePercent)} aria-valuetext={`${Math.round(treePercent)}% tree width`}
        tabIndex={interactive ? 0 : -1} aria-hidden={!interactive || undefined}
        onPointerDown={event => startDrag(event, split)} onPointerMove={event => moveDrag(event, split)}
        onPointerUp={event => { if (drag.current === event.pointerId) { finishDrag(); event.currentTarget.releasePointerCapture(event.pointerId); } }}
        onPointerCancel={finishDrag} onLostPointerCapture={finishDrag}
        onKeyDown={event => {
          const next = keyPercent(event, split);
          if (next !== null) { event.preventDefault(); resize(next); }
        }} />;
}
