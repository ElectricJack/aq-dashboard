// Synthetic upload/status fixtures only; no actual AQ writes or canonical PNG processing.
import { canonicalMedia, MEDIA_MAX } from "../api/adapters/resultMedia";
import type { FrozenUpload, UploadStatus } from "../api/adapters/resultMediaUpload";
import { fixtureArtifact, fixtureHash, fixtureMediaBinding, fixturePng } from "./resultMedia";
import { resultId } from "./results";
export const uploadActor = resultId(900);
export function uploadFile(bytes = fixturePng(), name = "Human example.png") { const file = new File([Uint8Array.from(bytes).buffer], name, { type: "image/png" }); Object.defineProperty(file, "arrayBuffer", { configurable: true, value: async () => Uint8Array.from(bytes).buffer }); return file; }
export function uploadFixture(state: UploadStatus["state"] = "reserved", frozen?: FrozenUpload): UploadStatus {
  const created = 1793518233000;
  const input = frozen?.input ?? { filename: "Human example.png", digest: fixtureHash(fixturePng()), bytes: fixturePng().length };
  const operation = frozen?.operation ?? resultId(800), actor = frozen?.actor ?? uploadActor, binding = frozen?.binding ?? fixtureMediaBinding();
  const raw = JSON.stringify({ operation_id: operation, input_digest: input.digest, input_bytes: input.bytes, filename: input.filename, capture: null });
  const artifact = fixtureArtifact(); artifact.receipt.artifact_id = operation; artifact.receipt.binding = binding; artifact.receipt.uploader_id = actor; artifact.receipt.input = input; artifact.receipt.retained_at_ms = created + 100; artifact.receipt.retain_until_ms = created + MEDIA_MAX.retention_ms; artifact.receipt_digest = fixtureHash(canonicalMedia(artifact.receipt));
  return { contract: "human-result-media-1", operation_id: operation, actor_id: actor, request_digest: frozen?.requestDigest ?? fixtureHash(raw), binding, input, capture: null, state, created_at_ms: created, upload_expires_at_ms: created + MEDIA_MAX.upload_ttl_ms, retain_until_ms: created + MEDIA_MAX.retention_ms,
    recovery: { put_allowed: state === "reserved" || state === "received", finalize_allowed: state === "received", reason: state === "reserved" ? "input_required" : state === "retained" ? "already_retained" : state === "finalizing" ? "busy" : state === "expired" ? "expired" : state === "rejected" ? "rejected" : null }, rejection: state === "rejected" ? "invalid_png" : null, artifact: state === "retained" ? artifact : null, limits: { ...MEDIA_MAX } };
}
export function uploadReference(status = uploadFixture()) { return new URLSearchParams({ media_upload: status.operation_id, media_actor: status.actor_id, media_request: status.request_digest, media_recipe: "1" }).toString(); }
