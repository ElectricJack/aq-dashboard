import { useLayoutEffect, useRef, useState, type ChangeEvent } from "react";
import { useSearchParams } from "react-router";
import { useSession } from "../../app/session";
import type { MediaBinding } from "../../api/adapters/resultMedia";
import { freezeUpload, reselectUpload, type FrozenUpload } from "../../api/adapters/resultMediaUpload";
import type { UploadAction } from "../../api/resultMediaUploadClient";
import { UploadActivity } from "./UploadActivity";
import { useUploadRequests } from "./useUploadRequests";
import { uploadReference, referenceKey, referenceParams, uploadFinished, recoveryAllowed, canFinishReference, uploadSelection, type Reference, type Snapshot } from "./uploadRecovery";

function validPng(file: File) {
  if (file.size === 0 || file.size > 1048576) return false;
  return !file.type || file.type === "image/png";
}

function useUploadDialog(open: boolean, setOpen: (open: boolean) => void) {
  const dialog = useRef<HTMLDialogElement>(null), actionButton = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => { const element = dialog.current; if (open) element?.showModal(); else element?.close(); return () => element?.close(); }, [open]);
  function close() { setOpen(false); requestAnimationFrame(() => actionButton.current?.focus()); }
  return { dialog, actionButton, close };
}

function snapshotFor(snapshot: Snapshot | null, key: string) {
  return snapshot?.key === key ? snapshot : { key, status: null, frozen: null, error: null };
}

export function useUploadControl({ binding, canWrite }: { binding: MediaBinding; canWrite: boolean }) {
  const { queryContext } = useSession(), [params, setParams] = useSearchParams();
  const { reference, hasReference, key } = uploadReference(params);
  const sameActor = reference?.actor === queryContext.principalId;
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [open, setOpen] = useState(hasReference), [working, setWorking] = useState(false), [selectedName, setSelectedName] = useState<string | null>(null), [acknowledged, setAcknowledged] = useState(false);
  const { status, frozen, error } = snapshotFor(snapshot, key);
  const terminal = uploadFinished(status);
  const [activity] = useState(() => new UploadActivity());
  activity.writeAllowed = canWrite;
  const { dialog, actionButton, close } = useUploadDialog(open, setOpen);
  const execute = useUploadRequests(binding, activity, { setWorking, setSelectedName, setSnapshot });
  useLayoutEffect(() => {
    activity.active = true;
    return () => { activity.active = false; activity.clearReference(); };
  }, []);
  useLayoutEffect(() => {
    if (activity.reference === key) { admitPrepared(); return; }
    resetReference();
    if (reference && sameActor) void execute("lookup", reference);
  }, [key]);

  function resetReference() {
    activity.reference = key;
    activity.clearReference();
    activity.busy = false;
    setWorking(false);
    setSelectedName(null);
    setSnapshot(null);
    setAcknowledged(false);
  }
  useLayoutEffect(() => {
    if (canWrite) return;
    if (activity.revokeWrite()) setWorking(false);
    setSelectedName(null);
    setSnapshot(old => old && { ...old, frozen: null });
  }, [canWrite]);
  function admitPrepared() {
    const prepared = activity.pendingAdmission;
    if (!prepared || !reference) return;
    if (!sameActor || !canWrite) return;
    activity.pendingAdmission = null;
    void execute("create", reference, prepared, true);
  }
  function saveReference(ref: Reference | null) {
    activity.reference = ref ? referenceKey(ref) : "empty";
    setParams(previous => referenceParams(previous, ref), { replace: true });
  }
  function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (activity.canChoose()) chooseFile(file);
  }

  function rejectFile() {
    if (!hasReference) clearSelectedFile();
    setSnapshot({ key, frozen, status, error: "Choose one PNG no larger than 1 MiB." });
  }

  function clearSelectedFile() {
    activity.selected = null;
    setSelectedName(null);
  }

  function chooseFile(file: File) {
    if (!validPng(file)) { rejectFile(); return; }
    if (!reference) { activity.selected = file; setSelectedName(file.name); setSnapshot(null); return; }
    if (!sameActor || terminal) return;
    void prepareOriginal(file, reference);
  }

  async function prepareOriginal(file: File, reference: Reference) {
    const ticket = activity.prepare();
    setWorking(true);
    try {
      const intent = status ? await reselectUpload(file, status) : await freezeUpload(file, binding, queryContext.principalId, reference);
      if (!activity.currentWrite(ticket)) return;
      activity.preparing = false;
      activity.selected = null;
      setSelectedName(intent.input.filename);
      setSnapshot({ key, frozen: intent, status, error: null });
    } catch {
      if (activity.currentWrite(ticket)) rejectOriginal();
    } finally {
      if (activity.finishPreparation(ticket)) setWorking(false);
    }
  }

  function rejectOriginal() {
    setSnapshot({ key, frozen, status,
      error: "That PNG does not reproduce the original upload. Keep the reference and reselect the original file." });
  }

  async function start() {
    if (!activity.canChoose()) return;
    if (hasReference || !activity.selected) return;
    const currentTicket = activity.prepare();
    setWorking(true);
    try {
      const intent = await freezeUpload(activity.selected, binding, queryContext.principalId);
      if (!activity.currentWrite(currentTicket)) return;
      admitAfterNavigation(intent);
    } catch {
      if (!activity.currentWrite(currentTicket)) return;
      activity.finishPreparation(currentTicket);
      setWorking(false);
      setSnapshot({ key, frozen: null, status: null,
        error: "This PNG could not be prepared. Use a static RGB or RGBA PNG within 1 MiB and 2 megapixels; remove unsupported metadata before choosing another file." });
    }
  }

  function admitAfterNavigation(intent: FrozenUpload) {
    activity.preparing = false;
    activity.selected = null;
    const ref: Reference = { operation: intent.operation, actor: intent.actor, requestDigest: intent.requestDigest, recipe: "1" };
    setSnapshot({ key: referenceKey(ref), frozen: intent, status: null, error: null });
    // Admission begins after the router commits the recovery URL.
    activity.pendingAdmission = intent;
    saveReference(ref);
  }

  function recover(action: UploadAction) {
    if (!sameActor || !reference) return;
    if (!activity.permits(action)) return;
    if (!recoveryAllowed(action, status, frozen)) return;
    void execute(action, reference, frozen ?? undefined, action === "create" || action === "put");
  }
  function finish() {
    if (activity.busy) return;
    if (!canFinishReference(terminal, acknowledged)) return;
    activity.generation++;
    activity.baseline = undefined;
    clearSelectedFile();
    setSnapshot(null);
    setAcknowledged(false);
    saveReference(null);
  }
  const canChoose = uploadSelection({ writable: canWrite, matchesActor: sameActor, hasReference, status });
  const enabledFile = canWrite && !!selectedName;
  const canStart = !working && enabledFile;
  const controls = { hasReference, terminal, working, reference, canWrite, validReference: sameActor, selectedName, error,
    status, frozen, acknowledged, canChoose, canStart, start, finish, choose, recover, setAcknowledged };
  return { controls, actionButton, open, setOpen, close, dialog };
}
export type UploadControls = ReturnType<typeof useUploadControl>["controls"];
