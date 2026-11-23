import { useRef, useEffect, type KeyboardEvent } from "react";
import { useNavigate } from "react-router";
import { nextTab } from "../../components/nextTab";

export const TABS = [["library", "Library"], ["runs", "Run history"]] as const;
type Tab = typeof TABS[number][0];
function playbookTab(params: URLSearchParams, runId: string | undefined, requests: boolean, hasRunFilters: boolean): Tab {
  if (runId || requests) return "runs";
  const view = params.get("view");
  if (view) return view === "runs" ? "runs" : "library";
  return hasRunFilters && !params.has("definition") ? "runs" : "library";
}

export function playbookRoute(params: URLSearchParams, runId?: string) {
  const view = runId ? null : params.get("view");
  const deployment = view === "deployment" || view === "activations";
  const requests = view === "start-requests" || view === "admissions";
  const hasRunFilters = ["state", "range"].some(key => params.has(key));
  const tab = playbookTab(params, runId, requests, hasRunFilters);
  const showRuns = tab === "runs" && !requests;
  return { tab, deployment, requests, showRuns, hasRunFilters };
}

type PlaybookView = "runs" | "deployment" | "start-requests";
function tabSearch(params: URLSearchParams, hasRunFilters: boolean, next?: PlaybookView) {
  const query = new URLSearchParams(params);
  query.delete("definition");
  query.delete("activation");
  if (next || hasRunFilters) query.set("view", next ?? "library");
  else query.delete("view");
  return query.toString();
}

function useTabFocus(tab: Tab, selectTab: (tab: Tab) => void) {
  const tabRefs = useRef(new Map<Tab, HTMLButtonElement>());
  const moved = useRef(false);
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    tabRefs.current.get(tab)?.focus();
  }, [tab]);
  function tabKey(event: KeyboardEvent) {
    const target = nextTab(TABS.map(([id]) => id), tab, event.key);
    if (!target) return;
    event.preventDefault();
    if (target !== tab) { moved.current = true; selectTab(target); }
  }
  return { tabRefs, tabKey };
}

export function usePlaybookNavigation(params: URLSearchParams, runId: string | undefined, { tab, deployment, requests, hasRunFilters }: ReturnType<typeof playbookRoute>) {
  const navigate = useNavigate();
  // Phone detail pages (run, definition or activation) hide the view toolbar; the back control leads out.
  const detail = Boolean(runId) || (tab === "library" && params.has(deployment ? "activation" : "definition"));
  const atTabRoot = ![detail, deployment, requests].includes(true);
  const viewSearch = (next?: PlaybookView) => tabSearch(params, hasRunFilters, next);
  function selectTab(next: Tab) {
    if (next === tab && atTabRoot) return;
    navigate({ pathname: "/playbooks", search: viewSearch(next === "runs" ? "runs" : undefined) });
  }
  const focus = useTabFocus(tab, selectTab);
  return { detail, ...focus, selectTab, viewSearch };
}
