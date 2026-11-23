import { useEffect, useLayoutEffect, useRef } from "react";
function focusComposer(pane: HTMLDivElement | null) {
  const target =
    pane?.querySelector<HTMLElement>("textarea:not([disabled])") ?? pane?.querySelector<HTMLElement>("h2");
  if (!target) return false;
  if (target.tagName === "H2" && !target.hasAttribute("tabindex")) target.tabIndex = -1;
  target.focus();
  return true;
}
export function useDockFocus(docked: boolean) {
  const presentation = useRef<HTMLDivElement>(null),
    focusDock = useRef(false);
  // Opening the dock moves focus into it (the launcher it replaces unmounts): the
  // composer, else the dock heading (SO-14, ISSUE-007). Close returns it below.
  useEffect(() => {
    if (!docked || !focusDock.current) return;
    let frame = 0,
      tries = 0;
    const attempt = () => {
      if (focusComposer(presentation.current)) focusDock.current = false;
      else if (++tries < 30) frame = requestAnimationFrame(attempt);
      else focusDock.current = false;
    };
    frame = requestAnimationFrame(attempt);
    return () => cancelAnimationFrame(frame);
  }, [docked]);
  return { presentation, focusDock };
}
export function useDockOffset(docked: boolean) {
  const surfaces = useRef<HTMLDivElement>(null);
  // The dock is an edge pane under the sticky header. The content area starts
  // at the header bottom, so its document offset is the dock's sticky top.
  useLayoutEffect(() => {
    const element = surfaces.current;
    if (!docked || !element) return;
    const main = element.closest("main") ?? element.parentElement;
    if (!main) return;
    return observeDockTop(element, main);
  }, [docked]);
  return surfaces;
}

function observeDockTop(element: HTMLElement, main: HTMLElement) {
    const measure = () => {
      const value = `${Math.max(0, Math.round(main.getBoundingClientRect().top + window.scrollY))}px`;
      if (element.style.getPropertyValue("--dock-top") !== value)
        element.style.setProperty("--dock-top", value);
    };
    measure();
    window.addEventListener("resize", measure);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (main.previousElementSibling) observer?.observe(main.previousElementSibling);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
}
