import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "../../../app/session";
import { ContractError } from "../../../api/adapters/contract";
import { ApiError } from "../../../api/client";
import { ActionButton } from "../../../components/layout/Workspace";
import { actionRequest, type ActionOperation, type FrozenAction } from "../../actions/actionClient";
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

type Status = ActionOperation["disposition"] | "retired";
function Action({ label: liveLabel, capability: capabilityName, freeze: liveFreeze, blocked, intro: liveIntro, confirm: liveConfirm, pendingText: livePending, confirmedText: liveConfirmed, changed = "the machine changed" }: SwarmActionProps) {
  // The dialog keeps the wording it opened with, so a refetch that changes the control's state cannot rewrite an operation in flight.
  const live = { label: liveLabel, intro: liveIntro, confirm: liveConfirm, pendingText: livePending, confirmedText: liveConfirmed, freeze: liveFreeze };
  const [snapshot, setSnapshot] = useState(live);
  const opener = useRef<HTMLButtonElement>(null);
  const { bootstrap, reportAccessDenied, reportIncompatible } = useSession();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false), [confirmed, setConfirmed] = useState(false);
  const [intent, setIntent] = useState<FrozenAction | null>(null), [operation, setOperation] = useState<ActionOperation | null>(null);
  const [retired, setRetired] = useState(false), [unknown, setUnknown] = useState(false), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false), [accessLost, setAccessLost] = useState(false);
  const { label, intro, confirm, pendingText, confirmedText, freeze } = open || intent ? snapshot : live;
  const dialog = useRef<HTMLDialogElement>(null), titleId = useId(), lock = useRef(false), current = useRef(true), controller = useRef<AbortController | null>(null), firstLookup = useRef<string | null>(null);
  const union = bootstrap.capability("dashboard.actions"), capability = union.enabled ? bootstrap.capability(capabilityName) : union;
  const unsettled = !!intent && (retired || unknown || !operation || operation.disposition === "pending" || operation.disposition === "unknown");
  const reason = accessLost ? "Access changed. Reload access" : !capability.enabled ? capability.reason : unsettled ? undefined : blocked;
  const refetch = () => void queryClient.invalidateQueries({ predicate: q => q.queryKey[4] === "swarm" });
  useEffect(() => { current.current = true; return () => { current.current = false; controller.current?.abort(); }; }, []);
  useEffect(() => { if (open) { if (!dialog.current?.open) dialog.current?.showModal(); } else if (dialog.current?.open) { dialog.current.close(); opener.current?.focus(); } }, [open]);
  async function run(value: FrozenAction, lookup = false) {
    if (lock.current || accessLost) return; lock.current = true; setBusy(true); const abort = new AbortController(); controller.current = abort;
    try {
      const next = await actionRequest(value, lookup, abort.signal); if (!current.current) return;
      if (operation?.request_digest && operation.operation_id === next.operation_id && operation.request_digest !== next.request_digest) throw new ContractError("Operation identity changed");
      setOperation(next); setUnknown(false); setError(null);
      if (next.disposition === "confirmed") refetch();
    } catch (failure) {
      if (!current.current) return;
      const status = failure instanceof ApiError ? failure.status ?? 0 : 0, envelope = failure instanceof ApiError ? failure.envelope : undefined;
      const settled = (disposition: "conflict" | "rejected", message: string) => { setOperation({ operation_id: value.id, disposition, request_digest: "", subject_refs: [], receipt_refs: [], affected_entities: [], ...(disposition === "conflict" ? { current_versions: envelope?.current_versions } : {}), recovery: "refresh_and_review" }); setUnknown(false); setError(envelope?.message ?? message); };
      if (failure instanceof ApiError && (status === 401 || status === 403)) { setAccessLost(true); setOperation(null); reportAccessDenied(failure); setError("Access changed. Reload access before checking the operation."); }
      else if (failure instanceof ApiError && status === 426) { reportIncompatible("dashboard.actions"); setUnknown(true); }
      else if (failure instanceof ApiError && status === 410) { setRetired(true); setUnknown(false); setError(null); }
      else if (!lookup && failure instanceof ApiError && status === 409 && envelope?.code === "machine_node") settled("rejected", "This node belongs to a service machine; revoke the machine.");
      else if (!lookup && failure instanceof ApiError && status === 409) settled("conflict", `${changed[0]!.toUpperCase()}${changed.slice(1)} since this page last loaded.`);
      else if (!lookup && failure instanceof ApiError && !failure.effectUnknown && [400, 404, 413, 422].includes(status)) settled("rejected", "The server refused this action. Review the current state and permissions.");
      else { setUnknown(true); setError(null); }
    } finally { lock.current = false; if (current.current) setBusy(false); if (controller.current === abort) controller.current = null; }
  }
  // Reconcile immediately after admission uncertainty; later lookups are paced.
  useEffect(() => {
    if (!intent || !unsettled || busy || accessLost || retired) return;
    const delay = firstLookup.current === intent.id ? 2000 : 0; firstLookup.current = intent.id;
    const timer = setTimeout(() => void run(intent, true), delay); return () => clearTimeout(timer);
  }, [intent, unsettled, busy, accessLost, retired]);
  function reset() { setIntent(null); setOperation(null); setRetired(false); setUnknown(false); setError(null); setConfirmed(false); }
  function launch() { if (!unsettled) { reset(); setSnapshot(live); } setOpen(true); }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (lock.current || intent || !capability.enabled || blocked) return;
    if (!confirmed) { setError("Confirm this action before submitting."); return; }
    let value: FrozenAction;
    try { value = freeze(); } catch (failure) { setError(failure instanceof Error ? failure.message : "Review the request."); return; }
    setIntent(value); setError(null); await run(value);
  }
  function reload() { refetch(); setOpen(false); reset(); }
  const status: Status | undefined = retired ? "retired" : unknown ? "unknown" : operation?.disposition;
  const locked = busy || !!intent || accessLost;
  return <div className={actionStyles.action}>
    <ActionButton ref={opener} disabled={!!reason} title={reason} onClick={launch}>{liveLabel}{unsettled ? " · operation" : ""}</ActionButton>
    {reason && <span className={actionStyles.meta}>{reason}</span>}
    <dialog className={actionStyles.dialog} ref={dialog} aria-labelledby={titleId} onCancel={e => { e.preventDefault(); setOpen(false); }} onClose={() => setOpen(false)}>
      <header className={actionStyles.header}><h2 id={titleId}>{label}</h2><ActionButton onClick={() => setOpen(false)} aria-label="Close action">Close</ActionButton></header>
      <div className={actionStyles.meta}>{intro}</div>
      {error && <p role="alert">{error}</p>}
      <form onSubmit={e => void submit(e)}><fieldset className={actionStyles.fields} disabled={locked}>
        <label className={actionStyles.confirm}><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />{confirm}</label>
      </fieldset>{!intent && <ActionButton type="submit" disabled={busy || accessLost || !capability.enabled || !!blocked}>Submit</ActionButton>}</form>
      {intent && <section className={actionStyles.operation} aria-label="Action status">
        <p role="status">{status === "retired" ? "Receipt details expired — the outcome is unavailable. Keep the original operation reference; do not submit it as a new operation." : status === "confirmed" ? confirmedText : status === "conflict" ? `Conflict — ${changed} since this page loaded. Reload to see its current state, then try again.` : status === "rejected" ? "Rejected — the server did not permit this action." : status === "pending" ? pendingText : "Outcome unknown — keep this operation and check its status."}</p>
        <div className={actionStyles.footer}>
          {unsettled && !retired && <><ActionButton disabled={busy || accessLost} onClick={() => void run(intent, true)}>Check status</ActionButton><ActionButton disabled={busy || accessLost || !capability.enabled} onClick={() => void run(intent)}>Retry exact submission</ActionButton></>}
          {(status === "conflict" || status === "rejected") && <ActionButton disabled={busy || accessLost} onClick={reload}>Reload current state</ActionButton>}
        </div>
        <details className={actionStyles.reference}><summary>Operation reference and receipts</summary><p>{intent.id}</p>{operation?.request_digest && <p>{operation.request_digest}</p>}{operation?.receipt_refs.map((r, i) => <p key={i}>{r.type} · {r.id}</p>)}</details>
      </section>}
    </dialog>
  </div>;
}
