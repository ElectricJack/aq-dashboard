import { useEffect, type RefObject } from "react";

function openDialog(dialog: HTMLDialogElement | null) {
  if (!dialog) return;
  if (dialog.showModal) dialog.showModal();
  else dialog.setAttribute("open", "");
}

function useDialogFocus(blocked: boolean, dialog: RefObject<HTMLDialogElement | null>) {
  useEffect(() => {
    if (!blocked) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    openDialog(dialog.current);
    return () => { dialog.current?.close?.(); previous?.focus(); };
  }, [blocked, dialog]);
}

export function useUnsavedWarning(unsaved: boolean, blocked: boolean, dialog: RefObject<HTMLDialogElement | null>) {
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);
  useDialogFocus(blocked, dialog);
}
