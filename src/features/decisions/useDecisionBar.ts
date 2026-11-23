import { useEffect, useRef, type RefObject } from "react";

/**
 * On phones only the action row is sticky; the note sits in the flow above it. When the
 * note gains focus (or the on-screen keyboard resizes the visible viewport), scroll it
 * clear of the sticky row so the bar never covers the field being typed into.
 */
export function keepClearOf(note: HTMLElement, row: HTMLElement | null) {
  if (!row || getComputedStyle(row).position !== "sticky") return;
  const vv = window.visualViewport;
  const visibleBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
  const limit = Math.min(row.getBoundingClientRect().top, visibleBottom) - 8;
  const overlap = note.getBoundingClientRect().bottom - limit;
  if (overlap > 0) window.scrollBy({ top: overlap });
}

function reserveActionBarSpace(root: HTMLElement, bar: HTMLElement, row: HTMLElement | null) {
  const sticky = getComputedStyle(bar).display === "contents" ? row : bar;
  if (!sticky) return;
  const inset = parseFloat(getComputedStyle(sticky).insetBlockEnd) || 0;
  root.style.scrollPaddingBlockEnd = `${Math.ceil(sticky.getBoundingClientRect().height + inset + 16)}px`;
}

function useStickyBarPadding(rowRef: RefObject<HTMLDivElement | null>) {
  // WCAG 2.4.11: reserve the sticky bar's measured height as the page's bottom scroll padding
  // so keyboard focus scrolled into view is never hidden behind the bar (desktop: whole bar;
  // phone: only the action row is sticky).
  const barRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const bar = barRef.current, root = document.documentElement;
    if (!bar || typeof ResizeObserver === "undefined") return;
    const update = () => reserveActionBarSpace(root, bar, rowRef.current);
    const observer = new ResizeObserver(update);
    observer.observe(bar); if (rowRef.current) observer.observe(rowRef.current);
    window.addEventListener("resize", update); update();
    return () => { observer.disconnect(); window.removeEventListener("resize", update); root.style.removeProperty("scroll-padding-block-end"); };
  }, []);

  return barRef;
}

export function useDecisionBar(available: boolean) {
  const noteRef = useRef<HTMLTextAreaElement>(null); const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const vv = window.visualViewport; const el = noteRef.current;
    if (!vv || !el) return;
    const onResize = () => { if (document.activeElement === el) keepClearOf(el, rowRef.current); };
    vv.addEventListener("resize", onResize); return () => vv.removeEventListener("resize", onResize);
  }, [available]);

  const barRef = useStickyBarPadding(rowRef);
  return { noteRef, rowRef, barRef };
}
