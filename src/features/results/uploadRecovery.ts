import { uploadId, type FrozenUpload, type UploadStatus } from "../../api/adapters/resultMediaUpload";
import type { UploadAction } from "../../api/resultMediaUploadClient";

export type Reference = { operation: string; actor: string; requestDigest: string; recipe: "1" };
export type Snapshot = { key: string; frozen: FrozenUpload | null; status: UploadStatus | null; error: string | null };
const fields = ["media_upload", "media_actor", "media_request", "media_recipe"] as const;

export function hasUploadReference(params: URLSearchParams) {
  return fields.some(key => params.has(key));
}

function parseReference(params: URLSearchParams): Reference | null {
  if (!fields.every(key => params.getAll(key).length === 1)) return null;
  const operation = params.get(fields[0]), actor = params.get(fields[1]);
  if (!uploadId(operation) || !uploadId(actor)) return null;
  const requestDigest = params.get(fields[2]), recipe = params.get(fields[3]);
  if (!requestDigest || !/^sha256:[0-9a-f]{64}$/.test(requestDigest)) return null;
  return recipe === "1" ? { operation, actor, requestDigest, recipe } : null;
}

export const referenceKey = (ref: Reference) => JSON.stringify([ref.operation, ref.actor, ref.requestDigest, ref.recipe]);
export function uploadReference(params: URLSearchParams) {
  const reference = parseReference(params);
  if (reference) return { reference, key: referenceKey(reference), hasReference: true };
  const hasReference = hasUploadReference(params);
  const key = hasReference ? `invalid:${fields.map(field => params.getAll(field).join(",")).join(":")}` : "empty";
  return { reference, key, hasReference };
}

export function referenceParams(params: URLSearchParams, ref: Reference | null) {
  const next = new URLSearchParams(params);
  fields.forEach(key => next.delete(key));
  if (ref) {
    next.set(fields[0], ref.operation);
    next.set(fields[1], ref.actor);
    next.set(fields[2], ref.requestDigest);
    next.set(fields[3], ref.recipe);
  }
  return next;
}

export function uploadFinished(status: UploadStatus | null) {
  return status !== null && ["retained", "rejected", "expired"].includes(status.state);
}

function canPut(status: UploadStatus | null | undefined, frozen?: FrozenUpload | null) {
  return !!frozen && !!status?.recovery.put_allowed;
}

export function recoveryAllowed(action: UploadAction, status: UploadStatus | null, frozen: FrozenUpload | null) {
  switch (action) {
    case "lookup": return true;
    case "create": return !!frozen?.raw;
    case "put": return canPut(status, frozen);
    case "finalize": return !!status?.recovery.finalize_allowed;
  }
}

type Step = (action: UploadAction) => Promise<UploadStatus | undefined>;
export async function uploadSteps(step: Step, action: UploadAction, options: { continueUpload: boolean; intent?: FrozenUpload }) {
  let status = await step(action);
  if (!options.continueUpload) return;
  if (status?.state === "reserved" && canPut(status, options.intent)) status = await step("put");
  if (status?.state === "received" && status.recovery.finalize_allowed) await step("finalize");
}

const states = {
  retained: "Image added to this report.",
  rejected: "The image was rejected. No image was retained.",
  expired: "This upload expired. It cannot be resumed.",
  reserved: "Upload reserved. The original PNG is still needed.",
  received: "Original PNG received. Finalize it to add the image.",
} as const;
export function recoveryMessage(status: UploadStatus) {
  if (status.state === "retained") return states.retained;
  if (status.recovery.reason === "expired") return "Upload deadline expired at the last check. This upload cannot resume.";
  if (status.state !== "finalizing") return states[status.state];
  return status.recovery.finalize_allowed ? "Processing stopped. Explicit finalization can reconcile this upload." : "Image processing is busy. Check its status before continuing.";
}


export function offeredRecoveryActions(status: UploadStatus | null, frozen: FrozenUpload | null) {
  const actions = ["create", "put", "finalize"] as const;
  if (uploadFinished(status)) return [];
  return actions.filter(action => {
    if (action === "create" && status) return false;
    return recoveryAllowed(action, status, frozen);
  });
}

export function canFinishReference(terminal: boolean, acknowledged: boolean) {
  return terminal || acknowledged;
}

export function uploadSelection(options: { writable: boolean; matchesActor: boolean; hasReference: boolean; status: UploadStatus | null }) {
  if (!options.writable) return false;
  if (!options.hasReference) return true;
  if (!options.matchesActor || uploadFinished(options.status)) return false;
  return !options.status || options.status.recovery.put_allowed;
}
