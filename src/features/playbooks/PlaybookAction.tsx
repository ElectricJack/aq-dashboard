import { ActionDialog, useActionAvailability } from "../actions/ActionDialog";
import { ActionReceiptPanel } from "../actions/ActionReceiptPanel";
import { useActionReceipt } from "../actions/useActionReceipt";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSession } from "../../app/session";
import { type FrozenAction } from "../actions/actionClient";
import actionStyles from "../actions/RecordActions.module.css";
import { freezePlaybookAction, playbookCapability, playbookLabels, type PlaybookKind, type PlaybookSubject } from "./playbookActions";

export type PlaybookActionProps = {
  kind: PlaybookKind;
  /** The namespace's project; the operation's scope must match it. */
  project: string;
  subject: PlaybookSubject;
  /** A domain reason the control is unavailable (for example a finished run). */
  blocked?: string | undefined;
  /** Shown under the dialog title: what the action does and does not do. */
  intro?: ReactNode;
  /** Required confirmation text; omitted when the action needs none. */
  confirm?: string;
  /** Typed fields; `locked` once submitted so the draft is preserved but frozen. */
  fields?: (locked: boolean) => ReactNode;
  /** Validates the draft and returns the payload; throws an Error with a user message. */
  build: () => { payload: Record<string, unknown>; reason?: string };
  pendingText: string;
  confirmedText: string;
  onConfirmed?: () => void;
  /** Refreshes the subject after conflict or rejection; the draft stays. */
  onReload?: () => Promise<unknown> | void;
  /** Called when a fresh action starts (not when reopening an unsettled one). */
  onStart?: () => void;
  className?: string;
  /** Identity of this control's draft; defaults to the subject. Start passes a stable value so changing the binding keeps the dialog. */
  instance?: string;
  /** A value that changes whenever the parent-owned draft changes; a shown validation error is re-checked against the new draft. */
  draft?: string;
};

export function PlaybookAction(props: PlaybookActionProps) {
  const { queryContext } = useSession();
  return <Action key={`${queryContext.principalId}:${queryContext.authorizationRevision}:${props.project}:${props.instance ?? `${props.subject.type}:${props.subject.id}`}`} {...props} />;
}

function Action({ kind, project, subject, blocked, intro, confirm, fields, build, pendingText, confirmedText, onConfirmed, onReload, onStart, className, draft }: PlaybookActionProps) {
  const [open, setOpen] = useState(false), [confirmed, setConfirmed] = useState(false);
  const receipt = useActionReceipt({
    conflict: () => "The expected version has changed.", rejected: "The server refused this action. Review the playbook and permissions.",
  }, onConfirmed);
  const { intent, setError, unsettled, resetReceipt } = receipt;
  const { capability, reason, disabled } = useActionAvailability(playbookCapability(kind), receipt, blocked);
  const label = playbookLabels[kind];
  const validation = useDraftValidation({ draft, build, confirm, confirmed, intent, setError });
  function reset() { validation.current = false; resetReceipt(); setConfirmed(false); }
  function launch() { if (!unsettled) { reset(); onStart?.(); } setOpen(true); }
  function prepare() {
    const { payload, reason } = build();
    requireConfirmation(confirm, confirmed);
    const value = freezePlaybookAction(kind, project, subject, { payload, reason });
    validation.current = false;
    return value;
  }
  function invalid(failure: unknown) { validation.current = true; setError(formError(failure)); }
  return <ActionDialog receipt={receipt} open={open} close={() => setOpen(false)} launch={launch}
    title={label} button={label} reason={reason} intro={intro} showIntro={!!intro} disabled={disabled}
    className={`${actionStyles.action} ${className ?? ""}`} submit={e => void receipt.submit(e, disabled, prepare, invalid)}
    fields={locked => <>{fields?.(locked)}{confirm && <label className={actionStyles.confirm}><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />{confirm}</label>}</>}>
      <ActionReceiptPanel state={receipt} versions text={{ confirmed: confirmedText, pending: pendingText,
        conflict: "Conflict — your draft is preserved.", rejected: "Rejected — the server did not permit this action. Review the playbook and permissions." }}
        recovery={{ enabled: capability.enabled, reload: () => void receipt.reload(onReload, reset), reloadLabel: "Reload current versions" }} />
  </ActionDialog>;
}


function requireConfirmation(confirm: ReactNode, confirmed: boolean) {
  if (confirm && !confirmed) throw new Error("Confirm this action before submitting.");
}
function formError(failure: unknown) { return failure instanceof Error ? failure.message : "Review the form."; }
function useDraftValidation({ draft, build, confirm, confirmed, intent, setError }: Pick<PlaybookActionProps, "draft" | "build" | "confirm"> & {
  confirmed: boolean; intent: FrozenAction | null; setError(value: string | null): void;
}) {
  // A validation error describes the draft, not the server: re-check it when the draft changes so it never goes stale.
  const validation = useRef(false), latestBuild = useRef(build); latestBuild.current = build;
  function validate() { latestBuild.current(); requireConfirmation(confirm, confirmed); }
  useEffect(() => {
    if (!validation.current || intent) return;
    try { validate(); validation.current = false; setError(null); } catch (failure) { setError(formError(failure)); }
  }, [draft, confirmed]);
  return validation;
}
