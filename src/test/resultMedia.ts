// Explicitly synthetic fixture descriptors and RGBA PNG bytes, not retained-owner proof.
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { canonicalMedia, CLIP_POLICY, resultMediaBinding, MEDIA_CLIP_MAX, MEDIA_MAX, type MediaArtifact, type MediaBinding, type MediaPage } from "../api/adapters/resultMedia";
import { resultId, resultRecord } from "./results";
export const fixtureMediaBinding = () => resultMediaBinding(resultRecord(), "recorded_legacy_native_only");
export const fixtureHash = (bytes: Uint8Array | string) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
function chunk(kind: string, bytes: Buffer) {
  const body = Buffer.concat([Buffer.from(kind), bytes]); let crc = 0xffffffff;
  for (const byte of body) { crc ^= byte; for (let i = 0; i < 8; i++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; }
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4); length.writeUInt32BE(bytes.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, body, checksum]);
}
export function fixturePng(red = 40): Uint8Array {
  const header = Buffer.alloc(13); header.writeUInt32BE(2, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return Uint8Array.from(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("sRGB", Buffer.from([0])), chunk("IDAT", deflateSync(Buffer.from([0, red, 60, 120, 255, 100, 160, 200, 255]))), chunk("IEND", Buffer.alloc(0))]));
}
export function fixtureArtifact(n = 1, binding: MediaBinding = fixtureMediaBinding(), bytes = fixturePng()): MediaArtifact {
  const receipt: MediaArtifact["receipt"] = { schema_version: 1, artifact_id: resultId(200 + n), binding, uploader_id: resultId(900), input: { filename: `Supplemental image ${n}.png`, digest: fixtureHash(bytes), bytes: bytes.length }, capture: null,
    rendering_policy: "aq.png.rgba8-srgb-v1", variants: { preview: { digest: fixtureHash(bytes), bytes: bytes.length, mime: "image/png", width: 2, height: 1 }, render: { digest: fixtureHash(bytes), bytes: bytes.length, mime: "image/png", width: 2, height: 1 } }, retained_at_ms: 1793518000000, retain_until_ms: 1793604400000 };
  return { receipt, receipt_digest: fixtureHash(canonicalMedia(receipt)), availability: { state: "available", observed_at_ms: 1793518234000, reason: null } };
}
export function fixtureMedia(items = [fixtureArtifact()], binding = fixtureMediaBinding()): MediaPage { return { contract: "human-result-media-1", server_time_ms: 1793518234000, binding, limits: { ...MEDIA_MAX }, items }; }
export function fixtureMediaHeaders(artifact = fixtureArtifact(), variant: "preview" | "render" = "preview") { const descriptor = artifact.receipt.variants[variant]; return { "Content-Type": "image/png", "Content-Length": String(descriptor.bytes), "AQ-Media-Digest": descriptor.digest, "AQ-Media-Receipt-Digest": artifact.receipt_digest, "Cache-Control": "private, no-store" }; }
/** Synthetic X26 clip receipt whose poster is fixtureArtifact(1); the dashboard validates clips but does not play them. */
export function fixtureClip(n = 2, binding: MediaBinding = fixtureMediaBinding()): MediaArtifact {
  const poster = fixtureArtifact(1, binding), clip = fixtureArtifact(n, binding); const receipt = clip.receipt;
  receipt.rendering_policy = CLIP_POLICY; receipt.input = { ...receipt.input, bytes: 2_000_000, filename: "flow.mp4" };
  receipt.variants = { preview: poster.receipt.variants.preview, render: { digest: receipt.input.digest, bytes: 2_000_000, mime: "video/mp4", width: 1280, height: 720 } };
  receipt.clip = { duration_ms: 12_000, poster_artifact_id: poster.receipt.artifact_id };
  clip.receipt_digest = fixtureHash(canonicalMedia(receipt)); return clip;
}
export const fixtureClipLimits = () => ({ ...MEDIA_MAX, ...MEDIA_CLIP_MAX });
