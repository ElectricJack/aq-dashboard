import { useEffect, useId, useRef, type FormEvent, type ReactNode, type RefObject } from "react";
import type { CapabilityState } from "../../api/adapters/bootstrap";
import { useSession } from "../../app/session";
import { ActionButton } from "../../components/layout/Workspace";
import type { useActionReceipt } from "./useActionReceipt";
import styles from "./RecordActions.module.css";

type Receipt = ReturnType<typeof useActionReceipt>;
export function useActionAvailability(name: string, state: Receipt, blocked: string | undefined) {
  const { bootstrap } = useSession();
  const union = bootstrap.capability("dashboard.actions");
  const capability = union.enabled ? bootstrap.capability(name) : union;
  const disabled = !capability.enabled || !!blocked;
  return { capability, disabled, reason: availabilityReason(capability, state, blocked) };
}
function availabilityReason(capability: CapabilityState, state: Receipt, blocked: string | undefined) {
  if (state.accessLost) return "Access changed. Reload access";
  if (!capability.enabled) return capability.reason;
  return state.unsettled ? undefined : blocked;
}

function useActionModal(open: boolean, opener?: RefObject<HTMLButtonElement | null>) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) {
      if (!dialog.current?.open) dialog.current?.showModal();
    } else if (dialog.current?.open) {
      dialog.current.close();
      opener?.current?.focus();
    }
  }, [open, opener]);
  return dialog;
}

type Props = {
  receipt: Receipt; open: boolean; close(): void; launch(): void; title: string; button: string;
  reason?: string; opener?: RefObject<HTMLButtonElement | null>; intro?: ReactNode; showIntro?: boolean; className?: string;
  submit(event: FormEvent): void; disabled: boolean; fields(locked: boolean): ReactNode; children: ReactNode;
};
export function ActionDialog({ receipt, open, close, launch, title, button, reason, opener, intro, showIntro, className, submit, disabled, fields, children }: Props) {
  const dialog = useActionModal(open, opener), titleId = useId();
  const locked = receipt.busy || !!receipt.intent || receipt.accessLost;
  return <div className={className ?? styles.action}>
    <ActionButton ref={opener} disabled={!!reason} title={reason} onClick={launch}>{button}{receipt.unsettled ? " · operation" : ""}</ActionButton>
    {reason && <span className={styles.meta}>{reason}</span>}
    <dialog className={styles.dialog} ref={dialog} aria-labelledby={titleId} onCancel={e => { e.preventDefault(); close(); }} onClose={close}>
      <header className={styles.header}><h2 id={titleId}>{title}</h2><ActionButton onClick={close} aria-label="Close action">Close</ActionButton></header>
      {showIntro ? <div className={styles.meta}>{intro}</div> : intro}
      {receipt.error && <p role="alert">{receipt.error}</p>}
      <form onSubmit={submit}><fieldset className={styles.fields} disabled={locked}>{fields(locked)}</fieldset>
        {!receipt.intent && <ActionButton type="submit" disabled={locked || disabled}>Submit</ActionButton>}
      </form>
      {children}
    </dialog>
  </div>;
}
