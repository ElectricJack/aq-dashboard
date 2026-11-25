import { useSearchParams } from "react-router";
import { useSession } from "../../app/session";
import { useScope } from "../../app/scope";
import { canonicalMedia, type MediaBinding } from "../../api/adapters/resultMedia";
import { ActionButton } from "../../components/layout/Workspace";
import { hasUploadReference, offeredRecoveryActions, recoveryMessage, canFinishReference } from "./uploadRecovery";
import { useUploadControl, type UploadControls } from "./useResultMediaUpload";
import styles from "./ResultMediaUpload.module.css";

export function ResultMediaUpload({ binding }: { binding: MediaBinding }) {
  const { bootstrap, queryContext } = useSession(), [scope] = useScope(), [params] = useSearchParams();
  const capability = bootstrap.capability("results.media.upload");
  const canWrite = capability.enabled;
  const canInspect = hasUploadReference(params) && bootstrap.capability("results.media.read").enabled;
  if (!canWrite && !canInspect) {
    const reason = capability.reason;
    return <p role="note" data-media-upload-unavailable>Image upload is unavailable: result media is not configured on this AQ server.{reason ? ` (${reason})` : ""}</p>;
  }
  return <UploadControl key={canonicalMedia([queryContext, scope, binding])} binding={binding} canWrite={canWrite} />;
}
function uploadLabels(controls: UploadControls) {
  if (!controls.hasReference) return { button: "Add image", heading: "Add image" };
  return { button: controls.terminal ? "Upload details" : "Upload status", heading: "Supplemental image upload" };
}

function UploadControl(props: { binding: MediaBinding; canWrite: boolean }) {
  const { controls, actionButton, open, setOpen, close, dialog } = useUploadControl(props);
  const labels = uploadLabels(controls);
  return <div className={styles.control}>
    <button ref={actionButton} type="button" className={styles.openButton} onClick={() => setOpen(true)}>{labels.button}</button>
    {open && <dialog ref={dialog} className={styles.dialog} aria-label="Add supplemental PNG" onCancel={event => { event.preventDefault(); close(); }}>
      <header><h2>{labels.heading}</h2><ActionButton onClick={close}>Close upload</ActionButton></header>
      <UploadForm {...controls} />
    </dialog>}
  </div>;
}

function UploadForm(model: UploadControls) {
  const { hasReference, validReference } = model;
  return <>
      <p>Upload a human-supplied PNG for this report. Capture details are unverified.</p>
      <ReferenceNotice {...model} />
      <UploadPicker {...model} />
      <UploadProgress {...model} />
      {validReference && <RecoveryActions {...model} />}
      {hasReference && <FinishReference {...model} />}
  </>;
}

function UploadProgress({ working, error, status }: UploadControls) {
  const messages = [
    working && "Checking or sending the original upload…",
    error,
    status && recoveryMessage(status),
  ];
  return <>{messages.map(message => message && <p key={message} role="status">{message}</p>)}</>;
}

function ReferenceNotice({ hasReference, reference, validReference, canWrite }: UploadControls) {
  return <>
      {hasReference && <p className={styles.reference}>Operation {reference?.operation ?? "Invalid reference"}</p>}
      {!canWrite && <p role="status">New uploads are unavailable. You can still inspect this upload.</p>}
      {hasReference && !validReference && <p role="status">This recovery reference is invalid or belongs to another account. It cannot send an upload.</p>}
  </>;
}

function UploadPicker(model: UploadControls) {
  const { hasReference, canChoose, working, choose, selectedName, start, canStart } = model;
  return <>
      {canChoose && <label className={styles.picker}>{hasReference ? "Reselect original PNG" : "PNG file"}<input type="file" accept="image/png,.png" disabled={working} onChange={choose} /><span>Static RGB/RGBA PNG · Up to 1 MiB and 2 megapixels</span></label>}
      {selectedName && <p className={styles.reference}>Selected: {selectedName}</p>}
      {!hasReference && <ActionButton disabled={!canStart} onClick={() => void start()}>Upload image</ActionButton>}
  </>;
}

const recoveryLabels = {
  create: "Replay original admission",
  put: "Resume original upload",
  finalize: "Finalize upload",
} as const;
function RecoveryActions({ working, recover, status, frozen, canWrite }: UploadControls) {
  const actions = offeredRecoveryActions(status, frozen);
  return <div className={styles.actions}>
    <ActionButton disabled={working} onClick={() => recover("lookup")}>Check upload status</ActionButton>
    {actions.map(action => <ActionButton key={action} disabled={working || !canWrite} onClick={() => recover(action)}>{recoveryLabels[action]}</ActionButton>)}
  </div>;
}

function FinishReference({ terminal, acknowledged, setAcknowledged, working, finish }: UploadControls) {
  return <>
        <p className={styles.note}>This page URL keeps the recovery reference. Closing does not cancel an upload. PNG bytes stay in memory only; after reload, resuming input requires the original file.</p>
        {!terminal && <label className={styles.acknowledge}><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} disabled={working} />I understand the previous upload may still complete if I remove this reference.</label>}
        <ActionButton disabled={working || !canFinishReference(terminal, acknowledged)} onClick={finish}>{terminal ? "Finish upload reference" : "Remove recovery reference"}</ActionButton>
      </>;
}
