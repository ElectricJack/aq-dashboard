import type { TotalView } from "../../api/adapters/inspection";

/** A server count; estimated is marked, unknown is never shown as zero. */
export function CountLabel({ total }: { total: TotalView }) {
  if (total.value === null) {
    return (
      <span aria-label="unknown" title="Count unknown">
        —
      </span>
    );
  }
  if (total.accuracy === "estimated") {
    return <span aria-label={`about ${total.value}`}>~{total.value}</span>;
  }
  return <span>{total.value}</span>;
}
