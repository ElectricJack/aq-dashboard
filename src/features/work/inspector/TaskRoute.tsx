import { useState, type ReactNode } from "react";
import { ApiError } from "../../../api/client";
import { levelLabel } from "../../../api/roleSettings";
import { routeHarnessLabel, routeProviderLabel, useTaskRoutes, type TaskRouteEntry, type TaskRouteView, type TaskRouting } from "../taskRouting";
import { useServerClock } from "./common";
import styles from "./Inspector.module.css";

/** `standard-high` → "Standard · High", the owner's words for a route's class: the level's id (Settings → Intelligence). */
export const classLabel = levelLabel;
/** How long ago `sinceMs` (epoch milliseconds) was by the server clock; null while that clock is unknown. */
export function elapsed(now: string | null, sinceMs: number): string | null {
  const ms = now === null ? NaN : Date.parse(now) - sinceMs;
  if (!Number.isFinite(ms)) return null;
  if (ms < 60_000) return "under 1 min";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min`;
  if (ms < 48 * 3_600_000) return `${Math.floor(ms / 3_600_000)} h`;
  return `${Math.floor(ms / 86_400_000)} d`;
}
export function routePreferenceSummary(route: TaskRouteView): string {
  const harnesses = route.prefer_harnesses ?? route.prefer;
  const providers = route.prefer_providers ?? [];
  return [
    harnesses.length > 0 ? `Preferred harness: ${harnesses.map(routeHarnessLabel).join(", then ")}` : "",
    providers.length > 0 ? `Preferred provider: ${providers.map(routeProviderLabel).join(", then ")}` : "",
  ].filter(Boolean).join(" · ");
}

/**
 * Where the task stands in routing (spec 0011 §8): "Waiting for routing" with how long it has waited, or its route:
 * class, lane, preferences and reasons. Shown only when the work read has a `routing` object. `lead` (the task's role)
 * shares the first line; preferences, who set it and, where there is room, the "Why" disclosure share the second
 * (density 2026-11-17).
 */
export function TaskRoute({ routing, taskId, lead }: { routing: TaskRouting; taskId: string; lead?: ReactNode }) {
  const now = useServerClock(), how = routing.since_ms === undefined ? null : elapsed(now, routing.since_ms), route = routing.route;
  if (routing.state === "unrouted") return null;
  if (routing.state === "waiting" || !route) return <div className={styles.reasons} data-task-route="waiting">
    <div className={styles.statusLine}>{lead}<p><strong>Waiting for routing</strong>{how && <> · <span>{how}</span></>}</p></div>
    <p className={styles.meta}>AQ doesn't offer this task to an agent until it has a route.</p>
  </div>;
  const preference = routePreferenceSummary(route);
  return <div className={styles.reasons} data-task-route="routed">
    <div className={styles.statusLine}>{lead}<p><span className={styles.meta}>Route</span> <strong>{classLabel(route.class)}</strong>{route.lane && <span> · lane {route.lane}</span>}</p></div>
    <div className={styles.statusLine}>
      <p className={styles.meta}>{preference && `${preference} · `}Set by {route.source === "owner" ? "the owner" : "the router"}{how && ` · ${how} ago`}</p>
      <RouteHistory taskId={taskId} />
    </div>
  </div>;
}

/** Each route the task has had with the reasons for it. Owner-only: when the read is refused (403) nothing shows. */
function RouteEntry({ entry, now }: { entry: TaskRouteEntry; now: string | null }) {
  const how = elapsed(now, entry.at_ms);
  const preference = entry.route && routePreferenceSummary(entry.route);
  return <li>
    <p><strong>{entry.route ? classLabel(entry.route.class) : "Route cleared"}</strong>{entry.route && <> · {entry.route.source === "owner" ? "owner" : "router"}</>}{how && <span className={styles.meta}> · {how} ago</span>}</p>
    {preference && <p className={styles.meta}>{preference}</p>}
    {entry.route && entry.route.reasons.length > 0 && <ul>{entry.route.reasons.map((reason, i) => <li key={i} data-route-reason={reason.code}>{reason.detail}</li>)}</ul>}
  </li>;
}

function RouteHistory({ taskId }: { taskId: string }) {
  const [open, setOpen] = useState(false), now = useServerClock(), query = useTaskRoutes(taskId, open);
  if (query.error instanceof ApiError && query.error.status === 403) return null;
  return <details className={styles.routeHistory} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Why this route</summary>
    {open && (query.data ? <ol aria-label="Route history">{query.data.length === 0 ? <li>No route history recorded.</li> : query.data.map(entry => <RouteEntry key={entry.sequence} entry={entry} now={now} />)}</ol> : <p className={styles.meta} role={query.isError ? "alert" : "status"}>{query.isError ? "The route history could not be read." : "Reading the route history…"}</p>)}
  </details>;
}
