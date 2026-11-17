import { useState } from "react";
import { ApiError } from "../../../api/client";
import { levelLabel } from "../../../api/roleSettings";
import { useTaskRoutes, type TaskRouteView, type TaskRouting } from "../taskWork";
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
const list = (values: string[], none: string) => values.length ? values.join(", ") : none;
/** Who may take a routed task: the route's harness and provider allowlists, and what it prefers. */
export function whoMayTake(route: Pick<TaskRouteView, "harnesses" | "providers" | "prefer">): string {
  const prefer = route.prefer.length ? `, preferring ${route.prefer.join(", ")}` : "";
  return `Harness: ${list(route.harnesses, "any")} · Provider: ${list(route.providers, "any")}${prefer}`;
}

/**
 * Where the task stands in routing (spec 0011 §8): "Waiting for routing" with how long it has waited, or its route:
 * class, lane, who may take it and why. Shown only when the work read has a `routing` object.
 */
export function TaskRoute({ routing, taskId }: { routing: TaskRouting; taskId: string }) {
  const now = useServerClock(), how = routing.since_ms === undefined ? null : elapsed(now, routing.since_ms), route = routing.route;
  if (routing.state === "unrouted") return null;
  if (routing.state === "waiting" || !route) return <div className={styles.reasons} data-task-route="waiting">
    <p><strong>Waiting for routing</strong>{how && <> · <span>{how}</span></>}</p>
    <p className={styles.meta}>AQ doesn't offer this task to an agent until it has a route.</p>
  </div>;
  return <div className={styles.reasons} data-task-route="routed">
    <p><span className={styles.meta}>Route</span> <strong>{classLabel(route.class)}</strong>{route.lane && <span> · lane {route.lane}</span>}</p>
    <p className={styles.meta}>{whoMayTake(route)}</p>
    <p className={styles.meta}>Set by {route.source === "owner" ? "the owner" : "the router"}{how && ` · ${how} ago`}</p>
    <RouteHistory taskId={taskId} />
  </div>;
}

/** Each route the task has had with the reasons for it. Owner-only: when the read is refused (403) nothing shows. */
function RouteHistory({ taskId }: { taskId: string }) {
  const [open, setOpen] = useState(false), now = useServerClock(), query = useTaskRoutes(taskId, open);
  if (query.error instanceof ApiError && query.error.status === 403) return null;
  return <details className={styles.routeHistory} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Why this route</summary>
    {open && (query.data ? <ol aria-label="Route history">{query.data.length === 0 ? <li>No route history recorded.</li> : query.data.map(entry => {
      const how = elapsed(now, entry.at_ms);
      return <li key={entry.sequence}>
        <p><strong>{entry.route ? classLabel(entry.route.class) : "Route cleared"}</strong>{entry.route && <> · {entry.route.source === "owner" ? "owner" : "router"}</>}{how && <span className={styles.meta}> · {how} ago</span>}</p>
        {entry.route && entry.route.reasons.length > 0 && <ul>{entry.route.reasons.map((reason, i) => <li key={i} data-route-reason={reason.code}>{reason.detail}</li>)}</ul>}
      </li>;
    })}</ol> : <p className={styles.meta} role={query.isError ? "alert" : "status"}>{query.isError ? "The route history could not be read." : "Reading the route history…"}</p>)}
  </details>;
}
