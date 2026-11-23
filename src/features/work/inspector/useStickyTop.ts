import { useEffect, type RefObject } from "react";

const STICKY_ELEMENTS = "[data-inspector-header],[data-inspector-bar]";

function visibleStickyHeader(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>(STICKY_ELEMENTS)].find(element => {
    const style = getComputedStyle(element);
    return style.position === "sticky" && style.display !== "contents";
  });
}

function updateStickyOffsets(root: HTMLElement, bar?: HTMLElement | null) {
  const top = bar && getComputedStyle(bar).position === "sticky" ? bar.offsetHeight : 0;
  root.style.setProperty("--inspector-sticky-top", `${top}px`);
  const padding = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
  const margin = Math.max(0, Math.ceil(top + (visibleStickyHeader(root)?.offsetHeight ?? 0) + 12 - padding));
  root.style.setProperty("--inspector-scroll-margin", `${margin}px`);
}

function revealControl(target: HTMLElement, header: HTMLElement) {
  const box = target.getBoundingClientRect(), edge = header.getBoundingClientRect().bottom;
  if (box.top >= edge || box.bottom <= 0) return;
  if (box.height < window.innerHeight - edge) window.scrollBy({ top: box.top - edge - 12 });
}

function revealOnFocus(root: HTMLElement) {
  let frame = 0;
  const reveal = (event: FocusEvent) => {
    const target = event.target, header = visibleStickyHeader(root);
    if (!(target instanceof HTMLElement) || !header) return;
    if (header.contains(target) || target.closest("dialog")) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => revealControl(target, header));
  };
  root.addEventListener("focusin", reveal);
  return () => { cancelAnimationFrame(frame); root.removeEventListener("focusin", reveal); };
}

function observeHeaderSizes(root: HTMLElement, bar: HTMLElement | null | undefined, resized: () => void) {
  if (typeof ResizeObserver === "undefined") return;
  const observer = new ResizeObserver(resized);
  if (bar) observer.observe(bar);
  root.querySelectorAll(STICKY_ELEMENTS).forEach(element => observer.observe(element));
  return observer;
}

/**
 * The sticky header's offset (the shell's own sticky top bar, when it has one at this width), and the scroll margin
 * that keeps a focused or scrolled-to control clear of everything pinned above it (P1-04). The document's
 * `scroll-padding-top` already clears the shell bar, so the margin adds only what the inspector pins below it.
 */
export function useStickyTop(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const bar = document.querySelector<HTMLElement>("main#content")?.parentElement?.querySelector<HTMLElement>(":scope > header");
    const apply = () => updateStickyOffsets(element, bar);
    const stopFocus = revealOnFocus(element);
    apply();
    const observer = observeHeaderSizes(element, bar, apply);
    window.addEventListener("resize", apply);
    return () => { observer?.disconnect(); stopFocus(); window.removeEventListener("resize", apply); };
  }, [ref]);
}
