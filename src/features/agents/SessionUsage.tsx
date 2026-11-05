import { useQuery } from "@tanstack/react-query";
import { adaptSessionUsage } from "../../api/adapters/sessionUsage";
import { sessionUsageJson } from "../../api/sessionUsageClient";
import { queryKey } from "../../api/queryKeys";
import { USAGE_CATEGORIES, type UnknownUsageReason, type UsageBinding, type UsageCost } from "../../api/wire/sessionUsage";
import { useSession } from "../../app/session";
import { ActionButton, DetailList } from "../../components/layout/Workspace";
import styles from "./SessionUsage.module.css";

const CATEGORY_LABELS = { input: "Input", output: "Output", cache_read: "Cache read", cache_write: "Cache write", reasoning: "Reasoning" };
const REASONS: Record<UnknownUsageReason, string> = { not_reported: "not reported", unsupported: "unsupported", source_gap: "source gap", not_applicable: "not applicable", incomplete: "incomplete" };
function money(cost: { amount_microunits: number; currency: string }) {
  // Preserve micro-unit precision; estimates are never invoices or account quota.
  const amount = BigInt(cost.amount_microunits);
  return `${cost.currency} ${amount / 1000000n}.${String(amount % 1000000n).padStart(6, "0")}`;
}
const ref = (a: { id: string; version: string }) => `${a.id} · revision ${a.version}`;
/** Reported, estimated and unknown values stay distinct; a missing value is never 0. */
function Cost({ cost }: { cost: UsageCost }) {
  if (cost.kind === "unknown") return <>Unknown · {REASONS[cost.reason]}</>;
  if (cost.kind === "provider_reported") return <>{money(cost)} · Provider reported<small className={styles.basis}>Receipt {ref(cost.receipt)}</small></>;
  const basis = <small className={styles.basis}>Cost basis {cost.currency} · rate card {ref(cost.rate_card)} · allocation policy {ref(cost.allocation_policy)}</small>;
  if (cost.basis === "subscription_allocation") return <>Flat subscription · not costed<small className={styles.basis}>Allocation estimate {money(cost)}, not an invoice</small>{basis}</>;
  return <>{money(cost)} · {cost.basis === "local_model_allocation" ? "Local model allocation estimate" : "Non-invoice estimate"}{basis}</>;
}

/** Mounted only while Session details is open; its key includes every binding field. */
export function SessionUsage({ binding }: { binding: UsageBinding }) {
  const { queryContext } = useSession();
  const query = useQuery({
    queryKey: queryKey(queryContext, "session-usage", { binding }),
    queryFn: async ({ signal }) => adaptSessionUsage(await sessionUsageJson(binding.attempt_id, signal), binding),
    retry: false, staleTime: 0, gcTime: 0, refetchOnWindowFocus: false, refetchOnReconnect: false,
  });
  return <section className={styles.usage} aria-label="Session usage">
    <h3>Session usage</h3>
    <p className={styles.note}>Accounting for this session. Categories may overlap; account quota and provider health are separate.</p>
    {query.isPending ? <p role="status">Loading session usage…</p> : query.isError ? <>
      <p role="status">Session usage unavailable. No accounting values are shown.</p>
      <ActionButton onClick={() => void query.refetch()}>Retry session usage</ActionButton>
    </> : <>
      {query.data.revision === 0 ? <p>No accounting projection has been recorded for this session.</p> : <>
        <p>{query.data.usage.completeness.kind === "unknown" ? "Accounting completeness unknown" : query.data.usage.completeness.kind === "incomplete" ? `Incomplete accounting · ${query.data.usage.completeness.reason}` : "Complete for the recorded accounting policy"}</p>
        <div className={styles.categories}>
          {USAGE_CATEGORIES.map((category, index) => {
            const counter = query.data.usage.counters[category];
            return <div key={category}>
              <strong>{CATEGORY_LABELS[category]}</strong>
              <span>{counter.kind === "known" ? counter.value.toLocaleString("en-US") : `Unknown · ${REASONS[counter.reason]}`}</span>
              {counter.kind === "unknown" && query.data.canonical_calls > 0 && <small>Reported subtotal: {query.data.known_category_subtotals[index]!.toLocaleString("en-US")} · partial</small>}
            </div>;
          })}
        </div>
        <DetailList>
          <dt>Canonical calls</dt><dd>{query.data.canonical_calls.toLocaleString("en-US")}</dd>
          <dt>Incomplete calls</dt><dd>{query.data.incomplete_calls.toLocaleString("en-US")}</dd>
          <dt>Unresolved events</dt><dd>{query.data.unresolved_events.toLocaleString("en-US")}</dd>
        </DetailList>
      </>}
      <DetailList><dt>Cost</dt><dd>{query.data.usage.costs.length === 0 ? "Unknown · not reported" : query.data.usage.costs.map((cost, index) => <div key={index} className={styles.cost}><Cost cost={cost} /></div>)}</dd>
        <dt>Ledger revision</dt><dd>{ref(query.data.usage.ledger_revision)}</dd>
        <dt>Task lineage totals</dt><dd>Unavailable on this AQ server</dd></DetailList>
      <p className={styles.note}>Checked <time dateTime={new Date(query.data.checked_at_ms).toISOString()}>{new Date(query.data.checked_at_ms).toISOString()}</time>
        {query.data.last_recorded_at_ms !== null && <> · Last accounting report <time dateTime={new Date(query.data.last_recorded_at_ms).toISOString()}>{new Date(query.data.last_recorded_at_ms).toISOString()}</time></>}</p>
      <ActionButton disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh session usage</ActionButton>
    </>}
  </section>;
}
