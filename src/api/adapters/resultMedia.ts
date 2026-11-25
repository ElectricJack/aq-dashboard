import { canonicalUuid as uuid, ContractError, isRecord, sameFields } from "./contract";
import type { ResultMetadata, ResultPage } from "./results";
export const MEDIA_CONTRACT = "human-result-media-1";
export type MediaBinding = { coverage: "recorded_legacy_native_only"; report_id: string; report_revision: string; project_id: string; task_id: string; attempt_id: string; source: { repository_id: string; base: { format: "sha1" | "sha256"; hex: string } } };
export type MediaVariant = { digest: string; bytes: number; mime: "image/png" | "video/mp4"; width: number; height: number };
export const IMAGE_POLICY = "aq.png.rgba8-srgb-v1", CLIP_POLICY = "aq.mp4.passthrough-v1";
/** X26 clip facts. The dashboard validates and keeps them but has no video UI. */
export type MediaClip = { duration_ms: number; poster_artifact_id: string };
export type MediaCapture = { scenario: string; captured_at_ms: number; viewport: { width_css: number; height_css: number; dpr_milli: number }; environment: string; claimed_source: MediaBinding["source"]["base"] | null };
export type MediaReceipt = { schema_version: 1; artifact_id: string; binding: MediaBinding; uploader_id: string; input: { digest: string; bytes: number; filename: string }; capture: MediaCapture | null; rendering_policy: typeof IMAGE_POLICY | typeof CLIP_POLICY; variants: { preview: MediaVariant; render: MediaVariant }; retained_at_ms: number; retain_until_ms: number; clip?: MediaClip };
export type MediaArtifact = { receipt: MediaReceipt; receipt_digest: string; availability: { state: "available" | "expired" | "missing" | "withheld" | "failed"; observed_at_ms: number; reason: null | "retention_expired" | "files_missing" | "owner_withheld" | "integrity_failed" | "storage_unavailable" } };
export type MediaLimits = { max_input_bytes: number; max_render_bytes: number; max_preview_bytes: number; max_pixels: number; max_dimension: number; max_result_artifacts: number; upload_ttl_ms: number; retention_ms: number; max_clip_bytes?: number; max_clip_duration_ms?: number };
export type MediaPage = { contract: typeof MEDIA_CONTRACT; server_time_ms: number; binding: MediaBinding; limits: MediaLimits; items: MediaArtifact[] };
export const MEDIA_MAX = { max_input_bytes: 1048576, max_render_bytes: 8388608, max_preview_bytes: 786432, max_pixels: 2000000, max_dimension: 4096, max_result_artifacts: 8, upload_ttl_ms: 1800000, retention_ms: 604800000 } satisfies MediaLimits;
/** Optional X26 clip limits (hard maxima from the pinned contract). */
export const MEDIA_CLIP_MAX = { max_clip_bytes: 4194304, max_clip_duration_ms: 60000 } as const;
export const isImageArtifact = (artifact: MediaArtifact) => artifact.receipt.rendering_policy === IMAGE_POLICY;
export function mediaCheck(value: unknown): asserts value { if (!value) throw new ContractError("Invalid supplemental result media"); }
/** Closed object: every `fields` key present, and nothing outside `fields` plus `optional`. */
export function mediaShape(value: unknown, fields: string, optional = ""): asserts value is Record<string, unknown> { mediaCheck(isRecord(value)); const keys = fields.split(" "), allowed = new Set([...keys, ...optional.split(" ").filter(Boolean)]); mediaCheck(keys.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => allowed.has(key))); }
function sha(v: unknown, prefix = true): v is string { return typeof v === "string" && (prefix ? /^sha256:[0-9a-f]{64}$/ : /^[0-9a-f]{64}$/).test(v); }
function uint(v: unknown, max: number, min = 1): v is number { return typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max; }
function time(v: unknown): v is number { return uint(v, Number.MAX_SAFE_INTEGER); }
function label(v: unknown, max: number): v is string { return typeof v === "string" && !!v.trim() && !/[\p{Cc}\p{Cs}]/u.test(v) && new TextEncoder().encode(v).length <= max; }
function objectId(v: unknown) { mediaShape(v, "format hex"); mediaCheck(typeof v.hex === "string" && (v.format === "sha1" ? /^[0-9a-f]{40}$/ : v.format === "sha256" ? /^[0-9a-f]{64}$/ : /$a/).test(v.hex)); }
function binding(v: unknown): asserts v is MediaBinding {
  mediaShape(v, "coverage report_id report_revision project_id task_id attempt_id source");
  mediaCheck(v.coverage === "recorded_legacy_native_only");
  mediaCheck(uuid(v.report_id));
  mediaCheck(sha(v.report_revision, false));
  mediaCheck(uuid(v.project_id));
  mediaCheck(uuid(v.task_id));
  mediaCheck(uuid(v.attempt_id));
  mediaShape(v.source, "repository_id base"); mediaCheck(uuid(v.source.repository_id)); objectId(v.source.base);
}
export function resultMediaBinding(row: ResultMetadata, coverage: ResultPage["coverage"]): MediaBinding {
  const expected: MediaBinding = { coverage, report_id: row.report_id, report_revision: row.revision, project_id: row.project_id, task_id: row.task_id, attempt_id: row.attempt_id, source: { repository_id: row.repository_id, base: { ...row.source_base } } };
  binding(expected); return expected;
}
export function sameMediaBinding(a: MediaBinding, b: MediaBinding): boolean {
  return sameFields(a, b, ["coverage", "report_id", "report_revision", "project_id", "task_id", "attempt_id"])
    && a.source.repository_id === b.source.repository_id && sameFields(a.source.base, b.source.base, ["format", "hex"]);
}
/** Integrity fingerprint of the closed receipt, not a signature or capture assertion. */
export function canonicalMedia(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalMedia).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalMedia(value[key])}`).join(",")}}`;
  mediaCheck(value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isSafeInteger(value)));
  return JSON.stringify(value);
}
export async function mediaDigest(bytes: Uint8Array): Promise<string> { const hash = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes)); return `sha256:${Array.from(new Uint8Array(hash), v => v.toString(16).padStart(2, "0")).join("")}`; }
function variant(v: unknown, maximum: number, mime: MediaVariant["mime"] = "image/png", dimension = 4096): asserts v is MediaVariant {
  mediaShape(v, "digest bytes mime width height");
  mediaCheck(sha(v.digest));
  mediaCheck(uint(v.bytes, maximum));
  mediaCheck(v.mime === mime);
  mediaCheck(uint(v.width, dimension));
  mediaCheck(uint(v.height, dimension));
  mediaCheck(mime !== "image/png" || v.width * v.height <= 2000000);
}
function mediaLimits(value: unknown): MediaLimits {
  mediaShape(value, Object.keys(MEDIA_MAX).join(" "), Object.keys(MEDIA_CLIP_MAX).join(" "));
  for (const [key, maximum] of Object.entries(MEDIA_MAX)) mediaCheck(uint(value[key], maximum));
  for (const [key, maximum] of Object.entries(MEDIA_CLIP_MAX)) {
    if (Object.hasOwn(value, key)) mediaCheck(uint(value[key], maximum));
  }
  mediaCheck(Number(value.upload_ttl_ms) < Number(value.retention_ms));
  return value as MediaLimits;
}

function checkCapture(capture: unknown) {
  if (capture === null) return;
  mediaShape(capture, "scenario captured_at_ms viewport environment claimed_source");
  mediaCheck(label(capture.scenario, 128));
  mediaCheck(time(capture.captured_at_ms));
  mediaCheck(label(capture.environment, 128));
  mediaShape(capture.viewport, "width_css height_css dpr_milli");
  mediaCheck(uint(capture.viewport.width_css, 4096));
  mediaCheck(uint(capture.viewport.height_css, 4096));
  mediaCheck(uint(capture.viewport.dpr_milli, 8000, 100));
  if (capture.claimed_source !== null) objectId(capture.claimed_source);
}

function checkInput(input: unknown, clip: boolean) {
  mediaShape(input, "digest bytes filename");
  mediaCheck(sha(input.digest));
  mediaCheck(uint(input.bytes, clip ? MEDIA_CLIP_MAX.max_clip_bytes : MEDIA_MAX.max_input_bytes));
  mediaCheck(label(input.filename, 256));
  mediaCheck(!/[\/\\]/.test(input.filename));
  mediaCheck(![".", ".."].includes(input.filename));
}

function checkVariants(receipt: Record<string, unknown>, clip: boolean) {
  mediaShape(receipt.variants, "preview render");
  const variants = receipt.variants;
  variant(variants.preview, MEDIA_MAX.max_preview_bytes, "image/png", clip ? 384 : 4096);
  variant(variants.render, MEDIA_MAX.max_render_bytes, clip ? "video/mp4" : "image/png");
  // A clip's preview comes from its poster. An image's preview is a downscale of the render.
  if (clip) {
    mediaShape(receipt.clip, "duration_ms poster_artifact_id");
    mediaCheck(uint(receipt.clip.duration_ms, MEDIA_CLIP_MAX.max_clip_duration_ms));
    mediaCheck(uuid(receipt.clip.poster_artifact_id));
    mediaCheck(receipt.clip.poster_artifact_id !== receipt.artifact_id);
  } else {
    const render = variants.render, longest = Math.max(render.width, render.height);
    const scaled = (dimension: number) => longest <= 384 ? dimension : Math.max(1, Math.floor(dimension * 384 / longest));
    mediaCheck(variants.preview.width === scaled(render.width));
    mediaCheck(variants.preview.height === scaled(render.height));
  }
}

function checkReceipt(value: unknown, expected: MediaBinding, previous: string): asserts value is MediaReceipt {
  mediaShape(value, "schema_version artifact_id binding uploader_id input capture rendering_policy variants retained_at_ms retain_until_ms", "clip");
  const clip = value.rendering_policy === CLIP_POLICY;
  mediaCheck(clip || value.rendering_policy === IMAGE_POLICY);
  mediaCheck(Object.hasOwn(value, "clip") === clip);
  mediaCheck(value.schema_version === 1);
  mediaCheck(uuid(value.artifact_id) && value.artifact_id > previous);
  mediaCheck(uuid(value.uploader_id));
  binding(value.binding);
  mediaCheck(sameMediaBinding(value.binding, expected));
  checkInput(value.input, clip);
  checkCapture(value.capture);
  checkVariants(value, clip);
  mediaCheck(time(value.retained_at_ms));
  mediaCheck(time(value.retain_until_ms));
  mediaCheck(value.retain_until_ms > value.retained_at_ms);
  mediaCheck(value.retain_until_ms - value.retained_at_ms <= MEDIA_MAX.retention_ms);
}

function checkAvailable(receipt: MediaReceipt, limits: MediaLimits) {
  const { preview, render } = receipt.variants;
  mediaCheck(render.bytes <= limits.max_render_bytes);
  mediaCheck(preview.bytes <= limits.max_preview_bytes);
  mediaCheck(Math.max(render.width, render.height) <= limits.max_dimension);
  if (receipt.rendering_policy === CLIP_POLICY) {
    mediaCheck(receipt.input.bytes <= Number(limits.max_clip_bytes));
    mediaCheck(receipt.clip!.duration_ms <= Number(limits.max_clip_duration_ms));
  } else {
    mediaCheck(receipt.input.bytes <= limits.max_input_bytes);
    mediaCheck(render.width * render.height <= limits.max_pixels);
  }
}

function checkAvailability(value: unknown, receipt: MediaReceipt, serverTime: number, limits: MediaLimits) {
  mediaShape(value, "state observed_at_ms reason");
  mediaCheck(time(value.observed_at_ms));
  mediaCheck(value.observed_at_ms >= receipt.retained_at_ms);
  mediaCheck(value.observed_at_ms <= serverTime);
  switch (value.state) {
    case "available":
      mediaCheck(value.reason === null);
      mediaCheck(serverTime < receipt.retain_until_ms);
      checkAvailable(receipt, limits);
      break;
    case "expired":
      mediaCheck(value.reason === "retention_expired");
      mediaCheck(value.observed_at_ms >= receipt.retain_until_ms);
      break;
    case "missing": mediaCheck(value.reason === "files_missing"); break;
    case "withheld": mediaCheck(value.reason === "owner_withheld"); break;
    default:
      mediaCheck(value.state === "failed");
      mediaCheck(["integrity_failed", "storage_unavailable"].includes(String(value.reason)));
  }
}

export async function adaptResultMedia(raw: unknown, expected: MediaBinding): Promise<MediaPage> {
  binding(expected);
  mediaShape(raw, "contract server_time_ms binding limits items");
  mediaCheck(raw.contract === MEDIA_CONTRACT);
  mediaCheck(time(raw.server_time_ms));
  binding(raw.binding);
  mediaCheck(sameMediaBinding(raw.binding, expected));
  const limits = mediaLimits(raw.limits);
  mediaCheck(Array.isArray(raw.items) && raw.items.length <= limits.max_result_artifacts);
  let previous = "";
  for (const item of raw.items) {
    mediaShape(item, "receipt receipt_digest availability");
    checkReceipt(item.receipt, expected, previous);
    previous = item.receipt.artifact_id;
    mediaCheck(sha(item.receipt_digest));
    const canonical = new TextEncoder().encode(canonicalMedia(item.receipt));
    mediaCheck(canonical.length <= 16384);
    mediaCheck(await mediaDigest(canonical) === item.receipt_digest);
    checkAvailability(item.availability, item.receipt, raw.server_time_ms, limits);
  }
  return raw as unknown as MediaPage;
}
