import { useState } from "react";
import type { ResultOperation } from "../../api/adapters/resultsFeedback";
import { ActionButton } from "../../components/layout/Workspace";
import { permitsRecovery } from "./resultOperationOutcome";
import type { ResultOperationControl } from "./useResultOperation";

function statusMessage(operation: ResultOperationControl) {
  if (operation.busy) return "Checking operation…";
  if (operation.refused !== null) {
    const reason = operation.refused ? ` ${operation.refused}.` : "";
    return `AQ refused this request.${reason} Your draft is preserved.`;
  }
  if (operation.unknown) return "Operation outcome is unknown. Check its status before another submission.";
  return `Operation ${operation.status?.disposition ?? "unknown"}.`;
}

type OperationView = {
  operation: ResultOperationControl; recover?: boolean; onCheck?: (value: ResultOperation) => void; onRevise?: () => Promise<void>;
};

function checkResult(callback: OperationView["onCheck"]) {
  return (value?: ResultOperation) => { if (value) callback?.(value); };
}

function CheckOperation({ busy, action, onCheck, label }: {
  busy: boolean; action: ResultOperationControl["lookup"]; onCheck: OperationView["onCheck"]; label: string;
}) {
  return <ActionButton disabled={busy} onClick={() => void action()?.then(checkResult(onCheck))}>{label}</ActionButton>;
}

function RecoverButton({ operation, recover, onCheck }: OperationView) {
  if (!recover || operation.terminal) return null;
  if (!permitsRecovery(operation.status)) return null;
  return <CheckOperation busy={operation.busy} action={operation.recover} onCheck={onCheck} label="Recover original request" />;
}

function permitsRevision(operation: ResultOperationControl) {
  return operation.terminal && operation.status?.disposition !== "confirmed";
}

export function OperationStatus(props: OperationView) {
  const { operation, onCheck, onRevise } = props;
  const [refreshing, setRefreshing] = useState(false);
  if (!operation.id) return null;
  const revise = () => {
    setRefreshing(true);
    void Promise.resolve(onRevise?.()).then(operation.reset).catch(() => {}).finally(() => setRefreshing(false));
  };
  return <section aria-label="Operation status">
    <p role="status">{statusMessage(operation)}</p>
    <div className="result-actions">
      <CheckOperation busy={operation.busy} action={operation.lookup} onCheck={onCheck} label="Check status" />
      <RecoverButton {...props} />
      {permitsRevision(operation) && <ActionButton disabled={operation.busy || refreshing} onClick={revise}>Revise draft</ActionButton>}
    </div>
    <details><summary>Operation reference</summary><p>{operation.id}</p></details>
  </section>;
}
