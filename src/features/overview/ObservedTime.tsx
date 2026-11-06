import { formatAge } from "../../components/time/relative";

/**
 * A server timestamp shown as a relative age against server time, like the rest
 * of the Overview. Without server time it falls back to a readable local date;
 * the exact instant stays in the tooltip and the machine-readable attribute.
 */
export function ObservedTime({ at, serverTime }: { at: string; serverTime?: string }) {
  const date = new Date(at);
  const absolute = Number.isNaN(date.getTime()) ? at : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return (
    <time dateTime={at} title={absolute}>
      {serverTime ? formatAge(serverTime, at) : absolute}
    </time>
  );
}
