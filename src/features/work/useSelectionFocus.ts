import { useEffect, useRef } from "react";
import { useMediaQuery } from "../../components/useMediaQuery";
import { pathFor } from "../knowledge/HumanNodeWorkspace";
import inspectorStyles from "../knowledge/HumanNodeWorkspace.module.css";

type FocusMode = { id?: string; graph: boolean; gantt: boolean; phone: boolean };

function selectionTarget(element: HTMLElement, id: string | undefined, graph: boolean, restore?: string) {
  if (id && !graph) return element.querySelector<HTMLElement>(`[data-work-inspector] .${inspectorStyles.detail}:not([aria-busy=true]) h2[data-inspector-title]`);
  if (restore) return [...element.querySelectorAll<HTMLAnchorElement>("a[href]")].find(link => new URL(link.href).pathname === pathFor("task", restore));
}

function focusWhenAvailable(element: HTMLElement, find: () => HTMLElement | null | undefined, options: FocusOptions) {
  function focus() {
    const target = find();
    if (!target) return false;
    if (target.tagName === "H2") target.tabIndex = -1;
    target.focus(options);
    return true;
  }
  if (focus()) return;
  const observer = new MutationObserver(() => { if (focus()) observer.disconnect(); });
  observer.observe(element, { childList: true, subtree: true });
  return () => observer.disconnect();
}

function restoreFocus(mode: FocusMode, previous: { id?: string; graph: boolean }) {
  const graphTap = mode.phone && mode.graph && previous.graph;
  if (graphTap && mode.id) return mode.id;
  if (!mode.id || mode.graph) return previous.id;
}

export function useSelectionFocus({ id, graph, gantt, phone }: FocusMode) {
  const stacked = useMediaQuery("(max-width: 999px)");
  const workspace = useRef<HTMLDivElement>(null), previous = useRef<{ id?: string; graph: boolean }>({ graph: false }), mounted = useRef(false);
  useEffect(() => {
    const before = previous.current; previous.current = { id, graph };
    // A deep link focuses the heading for screen readers without drawing a focus ring on arrival.
    // (A StrictMode re-run repeats the same selection, so it is still an arrival.)
    const arrival = !mounted.current || (before.id === id && before.graph === graph); mounted.current = true;
    const element = workspace.current; if (!element) return;
    // Selection focuses its loaded heading; Back restores the previously selected row/node.
    // Phone graph: a node tap keeps the graph open, so focus stays on the tapped node.
    const restore = restoreFocus({ id, graph, gantt, phone }, before);
    const options: FocusOptions = { preventScroll: gantt && !stacked, ...(arrival ? { focusVisible: false } : {}) };
    return focusWhenAvailable(element, () => selectionTarget(element, id, graph, restore), options);
  }, [id, graph, gantt, phone, stacked]);

  return workspace;
}

export function useEscapeFocus(focused: boolean, update: (key: string, value: string) => void) {
  // Esc restores the split, unless a dialog, menu or field is handling the key.
  useEffect(() => {
    if (!focused) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target instanceof Element ? e.target : null;
      if (t?.closest("dialog,[role=menu],input,textarea,select,[contenteditable=true]")) return;
      update("focus", "");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });
}
