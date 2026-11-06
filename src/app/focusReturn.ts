import { useCallback, useEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router";

/**
 * Focus management shared by every page (0002 §3 "Browser Back restores …
 * focus to the initiating item", QA SO-14, ISSUE-007, RA-10).
 */

type Origin = { href: string; index: number };
const MAX_ENTRIES = 50;
const RESTORE_WINDOW_MS = 3_000;
/** History entry key → the in-page link that left it. */
const origins = new Map<string, Origin>();

function remember(key: string, origin: Origin) {
  origins.delete(key);
  origins.set(key, origin);
  if (origins.size > MAX_ENTRIES) origins.delete(origins.keys().next().value!);
}

/** Whether Back to this entry will return focus to its initiating link (PageTitle then keeps its hands off). */
export function returnsFocusOnBack(key: string): boolean {
  return origins.has(key);
}

function linksTo(root: ParentNode, href: string): HTMLAnchorElement[] {
  return Array.from(root.querySelectorAll<HTMLAnchorElement>("a[href]")).filter((a) => a.getAttribute("href") === href);
}

/**
 * Shell-level: remembers the link that navigated away from each history entry
 * and, on Back/Forward (POP) to that entry, focuses the same link once the
 * page has rendered it. Gives up after a few seconds, or as soon as the user
 * moves focus themselves.
 */
export function useBackFocusRestore(container: () => HTMLElement | null) {
  const location = useLocation();
  const type = useNavigationType();
  const current = useRef(location.key);
  current.current = location.key;
  useEffect(() => {
    const record = (event: MouseEvent) => {
      const root = container();
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!root || !(link instanceof HTMLAnchorElement) || !root.contains(link)) return;
      const href = link.getAttribute("href")!;
      remember(current.current, { href, index: Math.max(0, linksTo(root, href).indexOf(link)) });
    };
    // Capture: the router handles the click (and re-renders) before a bubbling listener would run.
    document.addEventListener("click", record, true);
    return () => document.removeEventListener("click", record, true);
  }, [container]);
  useEffect(() => {
    if (type !== "POP") return;
    const origin = origins.get(location.key);
    if (!origin) return;
    let frame = 0;
    let moved = false;
    const deadline = performance.now() + RESTORE_WINDOW_MS;
    const onFocus = (event: FocusEvent) => { if (event.target instanceof HTMLElement && event.target !== document.body) moved = true; };
    document.addEventListener("focusin", onFocus);
    const attempt = () => {
      const root = container();
      // A page that restores its own focus (Work's graph node, a selected row) wins.
      const active = document.activeElement;
      if (root && active instanceof HTMLElement && active !== document.body && active.tagName !== "H1" && root.contains(active)) return finish();
      const links = root ? linksTo(root, origin.href) : [];
      const target = links[origin.index] ?? links[0];
      if (target) {
        target.focus({ preventScroll: true });
        return finish();
      }
      if (moved || performance.now() > deadline) return finish();
      frame = requestAnimationFrame(attempt);
    };
    const finish = () => document.removeEventListener("focusin", onFocus);
    attempt();
    return () => { cancelAnimationFrame(frame); finish(); };
  }, [location.key, type, container]);
}

/**
 * For panels, docks and drawers that are not modal dialogs: remember the
 * control that opened it and give focus back on close (RA-10, SO-14).
 */
export function useReturnFocus() {
  const origin = useRef<HTMLElement | null>(null);
  const rememberOrigin = useCallback((element?: HTMLElement | null) => {
    origin.current = element ?? (document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null);
  }, []);
  const restore = useCallback((fallback?: HTMLElement | null) => {
    const target = origin.current;
    origin.current = null;
    // After the closing render: the opener may have been hidden while the panel was open.
    requestAnimationFrame(() => (target?.isConnected ? target : fallback)?.focus());
  }, []);
  return { remember: rememberOrigin, restore };
}
