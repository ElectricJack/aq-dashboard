import type { AttentionView } from "../../api/adapters/inspection";
import { useScope, scopeSearch } from "../../app/scope";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { Panel } from "../../components/layout/Workspace";
import { AttentionRow, dedupeAttention } from "../overview/AttentionRows";
import { useOverviewRead } from "../overview/useOverviewRead";
import overview from "../overview/Overview.module.css";
import styles from "./Decisions.module.css";

type Covered = { reviews: boolean; questions: boolean; host: boolean };

/**
 * Overview "Needs you" counts every attention kind; the inbox lists only reviews, agent
 * questions and playbook decisions. The rest (blocked or failed work, offline workers,
 * uncertain operations, internal work) is listed here so View all reaches every item the
 * overview shows. A kind the inbox already lists is left out so nothing appears twice.
 */
export function otherAttention(items: readonly AttentionView[], covered: Covered): AttentionView[] {
  return dedupeAttention(items).filter(item =>
    !((item.kind === "decision" && (covered.reviews || covered.host)) || (item.kind === "question" && covered.questions)));
}

/** Overview attention the decision inbox does not list. Failure shows its own status; loading and empty render nothing in the inbox's place. */
export function OtherAttention({ covered }: { covered: Covered }) {
  const [scope] = useScope();
  const query = useOverviewRead(scope);
  const data = query.data;
  if (!data) {
    if (!query.isError) return null;
    return <Panel title="Other items that need you" className={styles.other}>
      <QueryStatus status="error" error={query.error} label="other items that need you" onRetry={() => void query.refetch()} />
    </Panel>;
  }
  const items = otherAttention(data.view.attention, covered);
  const listed = dedupeAttention(data.view.attention).length;
  const reported = data.view.counts.needs_you.value;
  const incomplete = data.coverage.state !== "complete" || data.view.sources.some(s => s.coverage.state !== "complete");
  const unlisted = reported !== null && reported > listed;
  if (!items.length && !unlisted && !incomplete) return null;
  const search = scopeSearch(scope);
  return <Panel title="Other items that need you" className={styles.other} description={items.length ? `${items.length} ${items.length === 1 ? "item" : "items"} outside reviews, questions and playbook decisions` : undefined}>
    {incomplete && <p className={styles.muted} role="status">Some sources are unavailable or incomplete, so this list may be incomplete.</p>}
    {unlisted && <p className={styles.muted} role="status">AQ reports {reported} {reported === 1 ? "item needs" : "items need"} you but listed {listed}. The rest are not available to this page.</p>}
    {items.length > 0 && <ul className={overview.attentionList} aria-label="Other items that need you">
      {items.map(item => <AttentionRow key={item.id} item={item} serverTime={data.serverTime} search={search} />)}
    </ul>}
  </Panel>;
}
