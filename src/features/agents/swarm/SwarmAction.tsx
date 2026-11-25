import { ActionDialog, useActionAvailability } from "../../actions/ActionDialog";
import { ActionReceiptPanel } from "../../actions/ActionReceiptPanel";
import { useActionReceipt } from "../../actions/useActionReceipt";
import { useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "../../../app/session";
import { type FrozenAction } from "../../actions/actionClient";
import actionStyles from "../../actions/RecordActions.module.css";

export type SwarmActionProps = {
  label: string; capability: string; freeze: () => FrozenAction; blocked?: string | undefined;
  intro: ReactNode; confirm: string; pendingText: string; confirmedText: string;
  /** Identity of the operation target (a machine id, "availability"). An unsettled operation never follows a different target. */
  scope: string;
  /** What a conflict says changed. */
  changed?: string;
};

/** A confirm-then-submit control for a swarm operation; the playbook action's transport, dialog and recovery, without typed fields. */
export function SwarmAction(props: SwarmActionProps) {
  const { queryContext } = useSession();
  return <Action key={`${queryContext.principalId}:${queryContext.authorizationRevision}:${props.scope}:${props.capability}`} {...props} />;
}

function Action({ label: liveLabel, capability: capabilityName, freeze: liveFreeze, blocked, intro: liveIntro, confirm: liveConfirm, pendingText: livePending, confirmedText: liveConfirmed, changed = "the machine changed" }: SwarmActionProps) {
  // The dialog keeps the wording it opened with, so a refetch that changes the control's state cannot rewrite an operation in flight.
  const live = { label: liveLabel, intro: liveIntro, confirm: liveConfirm, pendingText: livePending, confirmedText: liveConfirmed, freeze: liveFreeze };
  const [snapshot, setSnapshot] = useState(live);
  const opener = useRef<HTMLButtonElement>(null);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false), [confirmed, setConfirmed] = useState(false);
  const refetch = () => void queryClient.invalidateQueries({ predicate: q => q.queryKey[4] === "swarm" });
  const receipt = useActionReceipt({
    conflict: () => `${changed[0]!.toUpperCase()}${changed.slice(1)} since this page last loaded.`,
    rejected: "The server refused this action. Review the current state and permissions.",
    machineNode: "This node belongs to a service machine; revoke the machine.",
  }, refetch);
  const { intent, setError, unsettled, resetReceipt, forgetReceipt } = receipt;
  const { label, intro, confirm, pendingText, confirmedText, freeze } = open || intent ? snapshot : live;
  const { capability, reason, disabled } = useActionAvailability(capabilityName, receipt, blocked);
  function reset() { resetReceipt(); setConfirmed(false); }
  function launch() { if (!unsettled) { reset(); setSnapshot(live); } setOpen(true); }
  function prepare() {
    if (!confirmed) throw new Error("Confirm this action before submitting.");
    return freeze();
  }
  function invalid(failure: unknown) { setError(failure instanceof Error ? failure.message : "Review the request."); }
  function reload() { refetch(); setOpen(false); reset(); }
  // A busy refusal changed nothing: the owner submits again under a new operation, keeping the confirmation.
  const tryAgain = forgetReceipt;
  const contended = machineBusy(receipt.operation);
  return <ActionDialog receipt={receipt} open={open} close={() => setOpen(false)} launch={launch}
    title={label} button={liveLabel} reason={reason} opener={opener} intro={intro} showIntro disabled={disabled}
    submit={e => void receipt.submit(e, disabled, prepare, invalid)} fields={() => <label className={actionStyles.confirm}><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />{confirm}</label>}>
      <ActionReceiptPanel state={receipt} text={{ confirmed: confirmedText, pending: pendingText,
        conflict: `Conflict — ${changed} since this page loaded. Reload to see its current state, then try again.`,
        rejected: contended ? "The machine was busy; nothing changed. Try again." : "Rejected — the server did not permit this action." }}
        recovery={{ enabled: capability.enabled, reload, reloadLabel: "Reload current state", tryAgain: contended ? tryAgain : undefined }} />
  </ActionDialog>;
}


function machineBusy(operation: ReturnType<typeof useActionReceipt>["operation"]) {
  return operation?.disposition === "rejected" && operation.reason === "busy";
}
