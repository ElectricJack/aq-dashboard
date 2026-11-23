import { ActionButton } from "../../components/layout/Workspace";
import type { FrozenAction, ActionOperation } from "./actionClient";
import type { useActionReceipt } from "./useActionReceipt";
import styles from "./RecordActions.module.css";

type ReceiptState = ReturnType<typeof useActionReceipt>;
type Feedback = {
  confirmed: string; conflict: string; rejected: string; pending: string;
};
type Recovery = { enabled: boolean; reload(): void; reloadLabel: string; tryAgain?: () => void };

function statusText(status: ReceiptState["status"], text: Feedback) {
  if (status === "retired") return "Receipt details expired — the outcome is unavailable. Keep the original operation reference; do not submit it as a new operation.";
  if (!status || status === "unknown") return "Outcome unknown — keep this operation and check its status.";
  return text[status];
}

function VersionList({ versions }: { versions?: Record<string, string> }) {
  const entries = Object.entries(versions ?? {});
  return entries.length > 0 && <p>Current versions: {entries.map(([key, value]) => `${key}: ${value}`).join(", ")}</p>;
}

function Reference({ intent, operation, versions }: { intent: FrozenAction; operation: ActionOperation | null; versions?: boolean }) {
  return <details className={styles.reference}><summary>Operation reference and receipts</summary><p>{intent.id}</p>
    {operation?.request_digest && <p>{operation.request_digest}</p>}
    {operation?.receipt_refs.map((r, i) => <p key={i}>{r.type} · {r.id}{versions && r.revision ? ` · version ${r.revision}` : ""}</p>)}
  </details>;
}

function RecoveryButtons({ state, intent, recovery }: { state: ReceiptState; intent: FrozenAction; recovery: Recovery }) {
  const { busy, accessLost, unsettled, retired, run, status } = state;
  const disabled = busy || accessLost;
  return <div className={styles.footer}>
    {unsettled && !retired && <>
      <ActionButton disabled={disabled} onClick={() => void run(intent, true)}>Check status</ActionButton>
      <ActionButton disabled={disabled || !recovery.enabled} onClick={() => void run(intent)}>Retry exact submission</ActionButton>
    </>}
    {recovery.tryAgain && <ActionButton disabled={disabled || !recovery.enabled} onClick={recovery.tryAgain}>Try again</ActionButton>}
    {(status === "conflict" || status === "rejected") && <ActionButton disabled={disabled} onClick={recovery.reload}>{recovery.reloadLabel}</ActionButton>}
  </div>;
}

export function ActionReceiptPanel({ state, text, recovery, versions }: { state: ReceiptState; text: Feedback; recovery: Recovery; versions?: boolean }) {
  if (!state.intent) return null;
  return <section className={styles.operation} aria-label="Action status">
    <p role="status">{statusText(state.status, text)}</p>
    {versions && <VersionList versions={state.operation?.current_versions} />}
    <RecoveryButtons state={state} intent={state.intent} recovery={recovery} />
    <Reference intent={state.intent} operation={state.operation} versions={versions} />
  </section>;
}
