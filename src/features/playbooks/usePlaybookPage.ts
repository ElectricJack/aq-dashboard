import { useRef } from "react";
import { useParams, useSearchParams } from "react-router";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { playbookRoute, usePlaybookNavigation } from "./usePlaybookNavigation";
import { apiGet } from "../../api/client";
import { scopedKey, type QueryContext } from "../../api/queryKeys";
import type { Scope } from "../../api/wire/proposed";
import { adaptAdmissions, adaptRuns, mergeRunPages, type Run } from "../../api/adapters/playbooks";
import { useSession } from "../../app/session";
import { scopeSearch, useScope } from "../../app/scope";
import { CATALOG_CAPABILITY } from "../../api/adapters/playbookCatalog";
import { playbookScopeUnavailable } from "./PlaybookScope";
import { useObservedNow } from "./Age";

const BASE = "/api/playbooks/inspection";
export const MAX_PAGES = 4;
export function url(path: string, project: string | null, after?: string | null) {
  const q = new URLSearchParams({ limit: "25" });
  if (project) q.set("project_id", project);
  if (after) q.set("after", after);
  return `${BASE}${path}?${q}`;
}
export const RUN_STATES = ["admitted", "running", "waiting", "finishing", "cancelling", "blocked", "completed", "failed", "cancelled"];
export const RANGES: { key: string; label: string; ms: number | null }[] = [
  { key: "1h", label: "Last hour", ms: 3_600_000 }, { key: "24h", label: "Last 24 hours", ms: 86_400_000 },
  { key: "7d", label: "Last 7 days", ms: 604_800_000 }, { key: "all", label: "All loaded", ms: null },
];
export const DEFAULT_STATE = "all";
export const DEFAULT_RANGE = "24h";
type RunSelection = { filter: string; range: string; search: string; observedAt?: number };
function filteredSearch({ search, filter, range }: RunSelection) {
  const p = new URLSearchParams(search);
  if (filter !== DEFAULT_STATE) p.set("state", filter);
  if (range !== DEFAULT_RANGE) p.set("range", range);
  const value = p.toString();
  return value ? `?${value}` : "";
}

function filteredRuns(rows: Run[], selection: RunSelection) {
  const { filter, range, observedAt } = selection;
  const windowMs = RANGES.find(r => r.key === range)?.ms ?? null;
  const earliest = observedAt === undefined || windowMs === null ? -Infinity : observedAt - windowMs;
  const shown = rows.filter(r => r.admittedAt >= earliest && (filter === DEFAULT_STATE || r.status === filter));
  // Only a narrowing filter the user chose is announced; the default window is named by its own control (ISSUE-005).
  const filtering = filter !== DEFAULT_STATE || (range !== DEFAULT_RANGE && windowMs !== null);
  // Run links keep the list filters, so Back and "All runs" return to the same narrowed list.
  const listSearch = filteredSearch(selection);
  return { shown, filtering, listSearch };
}

function runPagesRemaining(last: ReturnType<typeof adaptRuns>, pages: ReturnType<typeof adaptRuns>[]) {
  if (pages.length >= MAX_PAGES) return undefined;
  return last.next ?? undefined;
}

function usePlaybookReads({ queryContext, scope, project }: { queryContext: QueryContext; scope: Scope; project: string | null }, showRuns: boolean, requests: boolean) {
  const runs = useInfiniteQuery({ queryKey: scopedKey(queryContext, scope, "playbook-runs", {}), initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => adaptRuns(await apiGet<unknown>(url("/runs", project, pageParam), signal), project, pageParam),
    getNextPageParam: runPagesRemaining, staleTime: 5000, enabled: showRuns, refetchOnWindowFocus: false });
  const admissions = useQuery({ queryKey: scopedKey(queryContext, scope, "playbook-admissions", {}), queryFn: async ({ signal }) => adaptAdmissions(await apiGet<unknown>(url("/admissions", project), signal), project), enabled: requests });
  return { runs, admissions };
}

function useRunFilters(params: URLSearchParams, setParams: ReturnType<typeof useSearchParams>[1]) {
  // Run filters live in the URL (spec 0002 §3); defaults are omitted and unknown values fall back to them.
  const filter = RUN_STATES.find(value => value === params.get("state")) ?? DEFAULT_STATE;
  const range = RANGES.find(({ key }) => key === params.get("range"))?.key ?? DEFAULT_RANGE;
  // Successive changes before a re-render build on each other (the router's functional update reads the last render).
  const latestParams = useRef(params); latestParams.current = params;
  function setRunFilter(key: "state" | "range", value: string, fallback: string) {
    const next = new URLSearchParams(latestParams.current);
    if (value === fallback) next.delete(key);
    else next.set(key, value);
    latestParams.current = next;
    setParams(next, { replace: true });
  }
  return { filter, range, setRunFilter };
}

function readRunRows(pages: Parameters<typeof mergeRunPages>[0]) {
  try {
    return { rows: mergeRunPages(pages), invalid: null };
  } catch (invalid) {
    return { rows: [], invalid };
  }
}

function projectOf(scope: Scope) {
  return scope.kind === "project" ? scope.project_id : null;
}

function useRetryRuns(runs: ReturnType<typeof usePlaybookReads>["runs"], runId?: string) {
  const client = useQueryClient();
  // Retry the detail alongside the roster when a run is open.
  return () => {
    void runs.refetch();
    if (runId) void client.refetchQueries({ predicate: q => q.queryKey.includes("playbook-run") });
  };
}

export function usePlaybookPage() {
  const { runId } = useParams<{ runId: string }>();
  const [scope] = useScope(); const search = scopeSearch(scope);
  const project = projectOf(scope);
  const { bootstrap, queryContext } = useSession();
  const [params, setParams] = useSearchParams();
  const route = playbookRoute(params, runId);
  const { tab, deployment, requests, showRuns } = route;
  const catalogEnabled = bootstrap.capability(CATALOG_CAPABILITY).enabled;
  const { filter, range, setRunFilter } = useRunFilters(params, setParams);
  const { runs, admissions } = usePlaybookReads({ queryContext, scope, project }, showRuns, requests);
  const pages = runs.data?.pages ?? [];
  const { rows, invalid } = readRunRows(pages);
  // Both filters narrow loaded rows only; the age window is measured against the server clock of the first page.
  const observedAt = pages[0]?.observedAt;
  const { shown, filtering, listSearch } = filteredRuns(rows, { filter, range, search, observedAt });
  const rosterFailed = Boolean(runs.isError || invalid);
  const activeRead = showRuns ? runs : admissions;
  const scopeUnavailable = playbookScopeUnavailable(project, activeRead.error);
  const retryRuns = useRetryRuns(runs, runId);
  const runsNow = useObservedNow(observedAt, runs.dataUpdatedAt);
  const admissionsNow = useObservedNow(admissions.data?.observedAt, admissions.dataUpdatedAt);
  const navigation = usePlaybookNavigation(params, runId, route);
  return {
    runId, project, queryContext, tab, deployment, showRuns, catalogEnabled,
    filter, range, setRunFilter, runs, admissions, rows, invalid, shown, filtering, listSearch,
    rosterFailed, scopeUnavailable, retryRuns, runsNow, admissionsNow, ...navigation,
  };
}

export type Page = ReturnType<typeof usePlaybookPage>;
