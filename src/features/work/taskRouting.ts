import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../api/client";
import { queryKey } from "../../api/queryKeys";
import { readRetry } from "../../api/retry";
import { validGraphId } from "../../api/adapters/humanGraph";
import { PANEL_READ, useSession } from "../../app/session";
import { isRecord } from "../../api/adapters/contract";
import { boundedList, boundedString, check, openEnumValue, text } from "./taskWorkFields";

export const TASK_ROUTE_PREFERENCES = "tasks.route.preferences";

/** Effective preferences are reported separately from historical routing fields. */
export type TaskRouteView = {
  class: string;
  harnesses: string[];
  providers: string[];
  prefer: string[];
  prefer_harnesses?: string[];
  prefer_providers?: string[];
  lane: string | null;
  provider_intent: string;
  source: string;
  policy_digest: string | null;
};

export function routeHarnessLabel(value: string): string {
  if (value === "claude") return "Claude";
  if (value === "claude-code") return "Claude Code";
  if (value === "codex") return "Codex";
  return value;
}

export function routeProviderLabel(value: string): string {
  if (value === "anthropic") return "Anthropic";
  if (value === "openai") return "OpenAI";
  return value;
}
/**
 * Where a task stands in routing (aq-server, human-graph-1 `routing`, optional): `routed` with its route, or `waiting`
 * (routing is on and the task is ready with no route, so AQ does not offer it yet), or `unrouted` (no route, nothing held
 * back: routing is off or the task is not ready; no `since_ms`). `since_ms` is epoch milliseconds: when the route was
 * written, or, waiting, when the task was last updated. Absent when the task's project is not on an automatic router.
 */
export type TaskRouting = { state: "routed" | "waiting" | "unrouted"; route?: TaskRouteView; since_ms?: number };
/** A route's class is the id of an intelligence profile (a level); the server decides which ids exist. */
const levelId = (v: unknown): v is string => typeof v === "string" && /^[a-z][a-z0-9-]{0,127}$/.test(v);
const names = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 32 && v.every(x => text(x, 128));
function adaptRoute(r: unknown): TaskRouteView {
  check(isRecord(r));
  check(levelId(r.class));
  check(names(r.harnesses));
  check(names(r.providers));
  check(names(r.prefer));
  check(r.prefer_harnesses === undefined || names(r.prefer_harnesses));
  check(r.prefer_providers === undefined || names(r.prefer_providers));
  check(r.lane === null || text(r.lane, 128));
  check(openEnumValue(r.provider_intent));
  check(openEnumValue(r.source));
  check(r.policy_digest === null || text(r.policy_digest, 128));
  return {
    class: r.class, harnesses: r.harnesses, providers: r.providers, prefer: r.prefer,
    ...(r.prefer_harnesses !== undefined && { prefer_harnesses: r.prefer_harnesses }),
    ...(r.prefer_providers !== undefined && { prefer_providers: r.prefer_providers }),
    lane: r.lane, provider_intent: r.provider_intent, source: r.source, policy_digest: r.policy_digest,
  };
}
/** `routing` is optional: an older server, or a project not on an automatic router, omits it. */
export function adaptTaskRouting(r: unknown): TaskRouting | undefined {
  if (r === undefined) return undefined;
  check(isRecord(r));
  if (r.state === "unrouted") { check(r.route === undefined && r.since_ms === undefined); return { state: "unrouted" }; }
  check(typeof r.since_ms === "number" && Number.isSafeInteger(r.since_ms) && r.since_ms >= 0);
  if (r.state === "waiting") { check(r.route === undefined); return { state: "waiting", since_ms: r.since_ms }; }
  check(r.state === "routed");
  return { state: "routed", route: adaptRoute(r.route), since_ms: r.since_ms };
}

/** One entry of a task's route history (`GET /api/tasks/{id}/routes`, owner-only), newest first; `route` is null for a cleared route. */
export type TaskRouteEntry = { sequence: number; at_ms: number; route: (TaskRouteView & { reasons: { code: string; detail: string }[] }) | null };
function routeReason(value: unknown) {
  check(isRecord(value));
  check(openEnumValue(value.code));
  check(boundedString(value.detail, 2000));
  return { code: value.code, detail: value.detail };
}

function historyRoute(value: unknown): TaskRouteEntry["route"] {
  if (value === null) return null;
  check(isRecord(value));
  check(boundedList(value.reasons, 32));
  const reasons = value.reasons.map(routeReason);
  return { ...adaptRoute(value), reasons };
}

function routeEntry(value: unknown): TaskRouteEntry {
  check(isRecord(value));
  check(typeof value.sequence === "number" && Number.isSafeInteger(value.sequence));
  check(value.sequence > 0);
  check(typeof value.at_ms === "number" && Number.isSafeInteger(value.at_ms));
  check(value.at_ms >= 0);
  return { sequence: value.sequence, at_ms: value.at_ms, route: historyRoute(value.route) };
}

export function adaptTaskRoutes(raw: unknown): TaskRouteEntry[] {
  check(isRecord(raw));
  check(boundedList(raw.items, 1000));
  return raw.items.map(routeEntry);
}

/** The route history; read only while the disclosure is open. A 403 (the viewer is not the owner) is an answer, not a fault. */
export function useTaskRoutes(id: string, enabled: boolean) {
  const { queryContext } = useSession();
  return useQuery({
    queryKey: queryKey(queryContext, "task-routes", { id }), enabled: enabled && validGraphId(id), refetchOnWindowFocus: false, meta: PANEL_READ, ...readRetry,
    queryFn: async ({ signal }) => adaptTaskRoutes(await apiGet<unknown>(`/api/tasks/${encodeURIComponent(id)}/routes`, signal)),
  });
}
