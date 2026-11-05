import { useLayoutEffect, useRef, useState, type ChangeEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { useSession } from "../../app/session";
import { useScope } from "../../app/scope";
import { queryKey } from "../../api/queryKeys";
import { ApiError } from "../../api/client";
import { canonicalMedia, type MediaBinding } from "../../api/adapters/resultMedia";
import { adaptUploadStatus, freezeUpload, reselectUpload, uploadId, type FrozenUpload, type UploadStatus } from "../../api/adapters/resultMediaUpload";
import { uploadRequest, type UploadAction } from "../../api/resultMediaUploadClient";
import { ActionButton } from "../../components/layout/Workspace";
import styles from "./ResultMediaUpload.module.css";
type Reference = { operation: string; actor: string; requestDigest: string; recipe: "1" };
type Snapshot = { key: string; frozen: FrozenUpload | null; status: UploadStatus | null; error: string | null };
const fields = ["media_upload", "media_actor", "media_request", "media_recipe"] as const;
function parseReference(params: URLSearchParams): Reference | null {
  const operation = params.get(fields[0]), actor = params.get(fields[1]), requestDigest = params.get(fields[2]), recipe = params.get(fields[3]);
  if (fields.some(key => params.getAll(key).length !== 1) || !uploadId(operation) || !uploadId(actor) || !requestDigest || !/^sha256:[0-9a-f]{64}$/.test(requestDigest) || recipe !== "1") return null;
  return { operation, actor, requestDigest, recipe };
}
const referenceKey = (ref: Reference) => JSON.stringify([ref.operation, ref.actor, ref.requestDigest, ref.recipe]);
export function ResultMediaUpload({ binding }: { binding: MediaBinding }) {
  const { bootstrap, queryContext } = useSession(), [scope] = useScope(), [params] = useSearchParams();
  const canWrite = bootstrap.capability("results.media.upload").enabled;
  if (!canWrite && !(fields.some(key => params.has(key)) && bootstrap.capability("results.media.read").enabled)) {
    const cap = bootstrap.capability("results.media.upload");
    return <p role="note" data-media-upload-unavailable>Image upload is unavailable: result media is not configured on this AQ server.{!cap.enabled && cap.reason ? ` (${cap.reason})` : ""}</p>;
  }
  return <UploadControl key={canonicalMedia([queryContext, scope, binding])} binding={binding} canWrite={canWrite} />;
}
function UploadControl({ binding, canWrite }: { binding: MediaBinding; canWrite: boolean }) {
  const { queryContext } = useSession(), [scope] = useScope(), [params, setParams] = useSearchParams(), client = useQueryClient();
  const reference = parseReference(params), hasReference = fields.some(key => params.has(key));
  const key = reference ? referenceKey(reference) : hasReference ? `invalid:${fields.map(field => params.getAll(field).join(",")).join(":")}` : "empty";
  const sameActor = reference?.actor === queryContext.principalId;
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [open, setOpen] = useState(hasReference), [working, setWorking] = useState(false), [selectedName, setSelectedName] = useState<string | null>(null), [acknowledged, setAcknowledged] = useState(false);
  const current = snapshot?.key === key ? snapshot : null, status = current?.status ?? null, frozen = current?.frozen ?? null;
  const terminal = !!status && ["retained", "rejected", "expired"].includes(status.state);
  const writeAllowed = useRef(canWrite), writeOwner = useRef<AbortController | null>(null); writeAllowed.current = canWrite;
  const dialog = useRef<HTMLDialogElement>(null), actionButton = useRef<HTMLButtonElement>(null), selected = useRef<File | null>(null);
  const pendingAdmission = useRef<FrozenUpload | null>(null), preparing = useRef(false);
  const jobs = useRef(new Set<AbortController>()), active = useRef(false), busy = useRef(false), ticket = useRef(0), ownReference = useRef<string | null>(null), baseline = useRef<UploadStatus | undefined>(undefined);
  useLayoutEffect(() => { active.current = true; return () => { active.current = false; ticket.current++; for (const job of jobs.current) job.abort(); selected.current = null; baseline.current = undefined; pendingAdmission.current = null; preparing.current = false; }; }, []);
  useLayoutEffect(() => {
    if (ownReference.current === key) {
      const prepared = pendingAdmission.current;
      if (prepared && reference && sameActor && canWrite && referenceKey(reference) === key) { pendingAdmission.current = null; void execute("create", reference, prepared, true); }
      return;
    }
    ownReference.current = key; pendingAdmission.current = null; preparing.current = false; ticket.current++; for (const job of jobs.current) job.abort(); busy.current = false; setWorking(false); selected.current = null; setSelectedName(null); baseline.current = undefined; setSnapshot(null); setAcknowledged(false);
    if (reference && sameActor) void execute("lookup", reference);
  }, [key]);
  useLayoutEffect(() => { if (!canWrite) { if (preparing.current) { preparing.current = false; ticket.current++; busy.current = false; setWorking(false); } if (pendingAdmission.current) { pendingAdmission.current = null; ticket.current++; busy.current = false; setWorking(false); } if (writeOwner.current) { writeOwner.current.abort(); writeOwner.current = null; ticket.current++; busy.current = false; setWorking(false); } selected.current = null; setSelectedName(null); setSnapshot(old => old ? { ...old, frozen: null } : old); } }, [canWrite]);
  useLayoutEffect(() => { const element = dialog.current; if (open) element?.showModal(); else element?.close(); return () => element?.close(); }, [open]);
  function close() { setOpen(false); requestAnimationFrame(() => actionButton.current?.focus()); }
  function saveReference(ref: Reference | null) {
    ownReference.current = ref ? referenceKey(ref) : "empty";
    setParams(previous => { const next = new URLSearchParams(previous); for (const field of fields) next.delete(field); if (ref) { next.set(fields[0], ref.operation); next.set(fields[1], ref.actor); next.set(fields[2], ref.requestDigest); next.set(fields[3], ref.recipe); } return next; }, { replace: true });
  }
  async function execute(action: UploadAction, ref: Reference, intent?: FrozenUpload, continueUpload = false) {
    const currentTicket = ++ticket.current, owner = new AbortController(), ownerKey = referenceKey(ref); jobs.current.add(owner); if (action !== "lookup") writeOwner.current = owner; busy.current = true; setWorking(true);
    const alive = () => active.current && ticket.current === currentTicket && !owner.signal.aborted;
    let latest: UploadStatus | undefined;
    const step = async (kind: UploadAction) => {
      if (kind !== "lookup" && !writeAllowed.current) return undefined;
      const value = await client.fetchQuery({ queryKey: queryKey(queryContext, "result-media-upload", { binding, scope, reference: ref, action: kind, attempt: currentTicket }), retry: false, staleTime: 0, gcTime: 0,
        queryFn: async ({ signal }) => adaptUploadStatus(await uploadRequest(kind, ref.operation, AbortSignal.any([owner.signal, signal]), intent), { binding, actor: queryContext.principalId, operation: ref.operation, requestDigest: ref.requestDigest, frozen: intent, previous: baseline.current }) });
      if (!alive()) return undefined;
      baseline.current = value; latest = value; setSnapshot({ key: ownerKey, frozen: !writeAllowed.current || ["retained", "rejected", "expired"].includes(value.state) ? null : intent ?? null, status: value, error: null });
      if (value.state === "retained") { selected.current = null; setSelectedName(null); void client.invalidateQueries({ predicate: query => query.queryKey[0] === "aq" && query.queryKey[4] === "result-media-list" && canonicalMedia((query.queryKey[5] as { binding?: MediaBinding })?.binding) === canonicalMedia(binding) }); }
      if (["rejected", "expired"].includes(value.state)) { selected.current = null; setSelectedName(null); }
      return value;
    };
    try {
      latest = await step(action);
      if (continueUpload && intent && latest?.state === "reserved" && latest.recovery.put_allowed) latest = await step("put");
      if (continueUpload && latest?.state === "received" && latest.recovery.finalize_allowed) await step("finalize");
    } catch (error) {
      if (!alive()) return;
      setSnapshot({ key: ownerKey, frozen: writeAllowed.current ? intent ?? null : null, status: null, error: error instanceof ApiError && error.status === 404 ? "No status is available yet. This upload may still exist; keep its recovery reference." : "Upload outcome is unknown. Check its status before continuing; no replacement was created." });
    } finally { jobs.current.delete(owner); if (writeOwner.current === owner) writeOwner.current = null; if (alive()) { busy.current = false; setWorking(false); } }
  }
  function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (!file || busy.current || !canWrite) return;
    if (file.size === 0 || file.size > 1048576 || (file.type && file.type !== "image/png")) { if (!hasReference) { selected.current = null; setSelectedName(null); } setSnapshot({ key, frozen, status, error: "Choose one PNG no larger than 1 MiB." }); return; }
    if (!reference) { selected.current = file; setSelectedName(file.name); setSnapshot(null); return; }
    if (!sameActor || terminal) return;
    const currentTicket = ++ticket.current; preparing.current = true; busy.current = true; setWorking(true);
    void (async () => {
      try {
        const intent = status ? await reselectUpload(file, status) : await freezeUpload(file, binding, queryContext.principalId, reference);
        if (!active.current || currentTicket !== ticket.current || !writeAllowed.current) return;
        preparing.current = false; selected.current = null; setSelectedName(intent.input.filename); setSnapshot({ key, frozen: intent, status, error: null });
      } catch { if (active.current && currentTicket === ticket.current && writeAllowed.current) setSnapshot({ key, frozen, status, error: "That PNG does not reproduce the original upload. Keep the reference and reselect the original file." }); }
      finally { if (active.current && currentTicket === ticket.current) { preparing.current = false; busy.current = false; setWorking(false); } }
    })();
  }
  async function start() {
    if (!canWrite || busy.current || hasReference || !selected.current) return;
    const currentTicket = ++ticket.current; preparing.current = true; busy.current = true; setWorking(true);
    try {
      const intent = await freezeUpload(selected.current, binding, queryContext.principalId);
      if (!active.current || currentTicket !== ticket.current || !writeAllowed.current) return;
      preparing.current = false; selected.current = null; const ref: Reference = { operation: intent.operation, actor: intent.actor, requestDigest: intent.requestDigest, recipe: "1" };
      setSnapshot({ key: referenceKey(ref), frozen: intent, status: null, error: null }); pendingAdmission.current = intent; saveReference(ref);
      // The reference layout effect starts admission only after the router commits
      // the exact recovery URL. A reload must never lose an already sent intent.
    } catch { if (active.current && currentTicket === ticket.current && writeAllowed.current) { preparing.current = false; busy.current = false; setWorking(false); setSnapshot({ key, frozen: null, status: null, error: "This PNG could not be prepared. Use a static RGB or RGBA PNG within 1 MiB and 2 megapixels; remove unsupported metadata before choosing another file." }); } }
  }
  function recover(action: UploadAction) {
    if (busy.current || !reference || !sameActor || (action !== "lookup" && !canWrite)) return;
    if (action === "create" && !frozen?.raw) return;
    if (action === "put" && (!frozen || !status?.recovery.put_allowed)) return;
    if (action === "finalize" && !status?.recovery.finalize_allowed) return;
    void execute(action, reference, frozen ?? undefined, action === "create" || action === "put");
  }
  function finish() {
    if (busy.current || (!terminal && !acknowledged)) return;
    ticket.current++; selected.current = null; baseline.current = undefined; setSnapshot(null); setSelectedName(null); setAcknowledged(false); saveReference(null);
  }
  const canReselect = canWrite && reference && sameActor && !terminal && (!status || status.recovery.put_allowed);
  return <div className={styles.control}>
    <button ref={actionButton} type="button" className={styles.openButton} onClick={() => setOpen(true)}>{hasReference ? terminal ? "Upload details" : "Upload status" : "Add image"}</button>
    {open && <dialog ref={dialog} className={styles.dialog} aria-label="Add supplemental PNG" onCancel={event => { event.preventDefault(); close(); }}>
      <header><h2>{hasReference ? "Supplemental image upload" : "Add image"}</h2><ActionButton onClick={close}>Close upload</ActionButton></header>
      <p>Upload a human-supplied PNG for this report. Capture details are unverified.</p>
      {hasReference && <p className={styles.reference}>Operation {reference?.operation ?? "Invalid reference"}</p>}
      {!canWrite && <p role="status">New uploads are unavailable. You can still inspect this upload.</p>}
      {hasReference && (!reference || !sameActor) && <p role="status">This recovery reference is invalid or belongs to another account. It cannot send an upload.</p>}
      {(!hasReference || canReselect) && canWrite && <label className={styles.picker}>{hasReference ? "Reselect original PNG" : "PNG file"}<input type="file" accept="image/png,.png" disabled={working} onChange={choose} /><span>Static RGB/RGBA PNG · Up to 1 MiB and 2 megapixels</span></label>}
      {selectedName && <p className={styles.reference}>Selected: {selectedName}</p>}
      {!hasReference && <ActionButton disabled={working || !selectedName || !canWrite} onClick={() => void start()}>Upload image</ActionButton>}
      {working && <p role="status">Checking or sending the original upload…</p>}
      {current?.error && <p role="status">{current.error}</p>}
      {status && <p role="status">{status.state === "retained" ? "Image added to this report." : status.recovery.reason === "expired" ? "Upload deadline expired at the last check. This upload cannot resume." : status.state === "rejected" ? "The image was rejected. No image was retained." : status.state === "expired" ? "This upload expired. It cannot be resumed." : status.state === "reserved" ? "Upload reserved. The original PNG is still needed." : status.state === "received" ? "Original PNG received. Finalize it to add the image." : status.recovery.finalize_allowed ? "Processing stopped. Explicit finalization can reconcile this upload." : "Image processing is busy. Check its status before continuing."}</p>}
      {reference && sameActor && <div className={styles.actions}>
        <ActionButton disabled={working} onClick={() => recover("lookup")}>Check upload status</ActionButton>
        {!terminal && !status && frozen?.raw && <ActionButton disabled={working || !canWrite} onClick={() => recover("create")}>Replay original admission</ActionButton>}
        {!terminal && status?.recovery.put_allowed && frozen && <ActionButton disabled={working || !canWrite} onClick={() => recover("put")}>Resume original upload</ActionButton>}
        {!terminal && status?.recovery.finalize_allowed && <ActionButton disabled={working || !canWrite} onClick={() => recover("finalize")}>Finalize upload</ActionButton>}
      </div>}
      {hasReference && <>
        <p className={styles.note}>This page URL keeps the recovery reference. Closing does not cancel an upload. PNG bytes stay in memory only; after reload, resuming input requires the original file.</p>
        {!terminal && <label className={styles.acknowledge}><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} disabled={working} />I understand the previous upload may still complete if I remove this reference.</label>}
        <ActionButton disabled={working || (!terminal && !acknowledged)} onClick={finish}>{terminal ? "Finish upload reference" : "Remove recovery reference"}</ActionButton>
      </>}
    </dialog>}
  </div>;
}
