import type { HistoryChange, HistoryEntry } from "../taskWork";
import { Ago, IdValue, humanize } from "./common";
import styles from "./Inspector.module.css";

const CATEGORY: Record<HistoryEntry["category"], string> = { revision: "Content", lifecycle: "Lifecycle", edge: "Relationship" };
/** Field names as the owner knows them; a field this bundle doesn't know is humanized. */
const FIELD: Record<string, string> = { task_state: "State", acceptance_criteria: "Acceptance criteria", content_type: "Content type", retirement_reason: "Retirement reason", successor_id: "Successor", valid_from: "Valid from", valid_until: "Valid until", review_at: "Review date" };
const fieldName = (field: string) => FIELD[field] ?? humanize(field);

function ChangedFields({ fields }: { fields: HistoryChange["fields"] }) {
  const valued = fields.filter(f => f.from !== null || f.to !== null), named = fields.filter(f => f.from === null && f.to === null);
  return <>
    {valued.length > 0 && <p className={styles.historyValues}>{valued.map(f => <span key={f.field} data-field={f.field}>
      <span>{fieldName(f.field)}</span> {f.from !== null ? <><span>{f.from}</span> <span aria-hidden>→</span><span className="visually-hidden">to</span> </> : null}<span>{f.to ?? "none"}</span>
    </span>)}</p>}
    {named.length > 0 && <p className={styles.meta}>Changed: {named.map(f => fieldName(f.field)).join(", ")}</p>}
  </>;
}

/**
 * What the entry changed (aq-server #99): AQ's summary, then each field, with `from → to` where AQ gives the
 * values (state, priority, content type, retired, deleted). "Partial" when AQ couldn't compare the revision.
 */
function Change({ change }: { change: HistoryChange }) {
  return <div className={styles.historyChange} data-history-change="">
    {(change.summary || !change.complete) && <p>{change.summary}{!change.complete && <span className={styles.partial} title="AQ couldn't read the previous revision, so this change may be incomplete."> Partial</span>}</p>}
    <ChangedFields fields={change.fields} />
    {change.edge && <p className={styles.meta}><span>{humanize(change.edge.edge_type)} {change.edge.direction === "incoming" ? "from" : "to"}</span> <IdValue id={change.edge.node_id} label="related node ID" /></p>}
  </div>;
}

export function TaskHistoryEntry({ entry: h }: { entry: HistoryEntry }) {
  return <li>
        {/* Operation, kind, who and when on one line (v1 density, 2026-11-06); what changed and why below. */}
        <p><strong>{humanize(h.operation)}</strong> <span className={styles.meta}>{CATEGORY[h.category]} · <span>{h.actor_id}</span> · <Ago at={h.created_at} /></span></p>
        {h.change && <Change change={h.change} />}
        {h.reason && <p className={styles.historyReason}>{h.reason}</p>}
      </li>;
}
