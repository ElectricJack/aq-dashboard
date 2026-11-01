#!/usr/bin/env node
// Actual disposable AQ Owner. Exactly one additional upload THROUGH THE UI, no interception.
import { chromium, expect, request } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
function required(name) { const value = process.env[name]; if (!value) throw new Error(`Required disposable fixture setting: ${name}`); return value; }
if (required("AQ_LIVE_ALLOW_MEDIA_UI_UPLOAD") !== "1") throw new Error("One UI upload requires explicit disposable-fixture opt-in");
const origin = new URL(required("AQ_LIVE_URL"));
if (!["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) || origin.protocol !== "http:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("Probe requires an explicit loopback fixture origin");
const expected = JSON.parse(required("AQ_LIVE_MEDIA_BINDING")), actor = required("AQ_LIVE_ACTOR_ID"), label = required("AQ_LIVE_MEDIA_FIXTURE_LABEL");
const baselineId = required("AQ_LIVE_MEDIA_BASELINE_ARTIFACT_ID"), baselineReceipt = required("AQ_LIVE_MEDIA_BASELINE_RECEIPT_DIGEST");
const inputPath = required("AQ_LIVE_MEDIA_INPUT_PNG"), inputDigest = required("AQ_LIVE_MEDIA_INPUT_DIGEST"), filename = required("AQ_LIVE_MEDIA_FILENAME");
const sha = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value !== null && typeof value === "object" ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
const bundleDigest = sha(await readFile(required("AQ_LIVE_CANDIDATE_MANIFEST"))), bytes = await readFile(inputPath);
const output = process.env.AQ_LIVE_OUTPUT_DIR ?? "/tmp/aq-result-media-ui-actual-browser";
expect(label).toMatch(/fixture/i); expect(filename).toMatch(/\.png$/i); expect(filename.trim()).toBe(filename); expect(filename).not.toMatch(/[\p{Cc}\p{Cs}\/\\]/u); expect(Buffer.byteLength(filename)).toBeLessThanOrEqual(256);
expect(inputDigest).toMatch(/^sha256:[0-9a-f]{64}$/); expect(sha(bytes)).toBe(inputDigest); expect(bytes.length).toBeLessThanOrEqual(1048576);
const dimensions = pngShape(bytes), chunks = inputPngPolicy(bytes);
const reportPath = `/api/human/results/${expected.report_id}/revisions/${expected.report_revision}`, mediaPath = `${reportPath}/media`, pagePath = `/results/${expected.report_id}/revisions/${expected.report_revision}`;
await mkdir(output, { recursive: true });
const api = await request.newContext({ baseURL: origin.origin, timeout: 10000, maxRedirects: 0 }), browser = await chromium.launch({ headless: true });
const started = performance.now(), pages = [], captures = [], errors = [], external = [], writes = [], observations = [], evidenceJobs = [];
let savedIntent = null, admitted = null, recoveryUrl = null;
async function get(path) { const response = await api.get(path); expect(response.status(), path).toBe(200); return response.json(); }
function track(page) {
  pages.push(page); page.on("pageerror", error => errors.push(error.message));
  page.on("request", req => {
    const url = new URL(req.url()); if (!["http:", "https:"].includes(url.protocol)) return;
    if (url.origin !== origin.origin) external.push(url.origin);
    if (!["GET", "HEAD"].includes(req.method())) {
      const body = req.postDataBuffer() ?? Buffer.alloc(0);
      writes.push({ method: req.method(), path: url.pathname, bytes: body.length, digest: sha(body), request_url: page.url(), csrf: req.headers()["x-aq-request"] ?? null, mime: req.headers()["content-type"] ?? null });
      if (req.method() === "POST" && url.pathname === `${mediaPath}-uploads`) {
        const create = JSON.parse(body.toString("utf8"));
        savedIntent = { operation_id: create.operation_id, request_digest: sha(body), create, committed_url: page.url() };
        evidenceJobs.push(writeFile(join(output, "saved-intent.json"), JSON.stringify(savedIntent, null, 2) + "\n"));
      }
      if (writes.length > 3) void page.close(); // Stop an unexpected UI write loop; never retry.
    }
  });
  page.on("response", response => { if (response.url().includes("/media-uploads") || response.url().includes("/result-media-uploads/")) observations.push({ path: new URL(response.url()).pathname, status: response.status(), method: response.request().method() }); });
}
async function capture(page, filename) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), "no page horizontal overflow").toBe(false);
  const path = join(output, filename); await page.screenshot({ path }); captures.push(path);
}
async function blobProof(image, descriptor) {
  await expect(image).toBeVisible(); await expect(image).toHaveAttribute("src", /^blob:/); await expect.poll(() => image.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  const fact = await image.evaluate(async img => { const response = await fetch(img.src), body = await response.arrayBuffer(), hash = await crypto.subtle.digest("SHA-256", body); return { digest: `sha256:${[...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, "0")).join("")}`, bytes: body.byteLength, mime: response.headers.get("Content-Type"), width: img.naturalWidth, height: img.naturalHeight }; });
  expect(fact).toEqual({ digest: descriptor.digest, bytes: descriptor.bytes, mime: "image/png", width: descriptor.width, height: descriptor.height }); return fact;
}
async function picker(page, name) {
  await page.goto(new URL(pagePath, origin).href); await expect(page.getByRole("heading", { name: label, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add image", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add supplemental PNG", exact: true });
  await dialog.getByLabel(/^PNG file/).setInputFiles({ name: filename, mimeType: "image/png", buffer: bytes });
  await expect(dialog.getByText(`Selected: ${filename}`, { exact: true })).toBeVisible();
  const close = dialog.getByRole("button", { name: "Close upload", exact: true }), upload = dialog.getByRole("button", { name: "Upload image", exact: true });
  await expect(upload).toBeEnabled(); const bounds = { close: await close.boundingBox(), upload: await upload.boundingBox() }, height = page.viewportSize().height;
  for (const [key, box] of Object.entries(bounds)) { expect(box.height, `${key}44px`).toBeGreaterThanOrEqual(44); expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height, `${key} visible`).toBeLessThanOrEqual(height); }
  expect(new URL(page.url()).searchParams.has("media_upload")).toBe(false); await capture(page, `${name}-actual-picker.png`); return { dialog, close, upload, bounds };
}
function pngShape(bytes, descriptor) {
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])); expect(bytes.toString("ascii", 12, 16)).toBe("IHDR");
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  expect(width).toBeGreaterThan(0); expect(height).toBeGreaterThan(0); expect(width * height).toBeLessThanOrEqual(2000000); expect(Math.max(width, height)).toBeLessThanOrEqual(4096);
  expect(bytes[24]).toBe(8); expect([2, 6]).toContain(bytes[25]); expect(bytes[28]).toBe(0);
  if (descriptor) { expect(width).toBe(descriptor.width); expect(height).toBe(descriptor.height); expect(bytes[25]).toBe(6); }
  return { width, height };
}
function inputPngPolicy(bytes) {
  // Do not rewrite screenshots. Abort before admission if Chromium emits unsupported metadata.
  const kinds = []; let offset = 8, idat = false, afterIdat = false, srgb = false, ended = false;
  while (offset < bytes.length) {
    expect(offset + 12).toBeLessThanOrEqual(bytes.length);
    const length = bytes.readUInt32BE(offset), end = offset + 12 + length;
    expect(end).toBeLessThanOrEqual(bytes.length);
    const kind = bytes.toString("ascii", offset + 4, offset + 8); kinds.push(kind);
    expect(["IHDR", "sRGB", "IDAT", "IEND"]).toContain(kind);
    let crc = 0xffffffff;
    for (const value of bytes.subarray(offset + 4, end - 4)) { crc ^= value; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; }
    expect(bytes.readUInt32BE(end - 4)).toBe((crc ^ 0xffffffff) >>> 0);
    if (kinds.length === 1) { expect(kind).toBe("IHDR"); expect(length).toBe(13); }
    else expect(kind).not.toBe("IHDR");
    if (kind === "sRGB") { expect(srgb || idat).toBe(false); expect(length).toBe(1); expect(bytes[offset + 8]).toBeLessThanOrEqual(3); srgb = true; }
    if (kind === "IDAT") { expect(afterIdat).toBe(false); idat = true; }
    else if (idat) afterIdat = true;
    if (kind === "IEND") { expect(length).toBe(0); expect(idat).toBe(true); expect(end).toBe(bytes.length); ended = true; }
    offset = end;
  }
  expect(ended).toBe(true); expect(bytes[26]).toBe(0); expect(bytes[27]).toBe(0);
  return kinds;
}
try {
  const bootstrap = await get("/api/v1/bootstrap"); expect(bootstrap.data.product.dashboard_digest).toBe(bundleDigest); expect(bootstrap.data.principal.id).toBe(actor);
  for (const name of ["results.read", "results.media.read", "results.media.upload"]) expect(bootstrap.data.capabilities.some(cap => cap.name === name && cap.version === "1" && cap.enabled === true), name).toBe(true);
  const metadata = await get(reportPath); expect(metadata.items).toHaveLength(1); const row = metadata.items[0];
  expect({ coverage: metadata.coverage, report_id: row.report_id, report_revision: row.revision, project_id: row.project_id, task_id: row.task_id, attempt_id: row.attempt_id, source: { repository_id: row.repository_id, base: row.source_base } }).toEqual(expected); expect(row.conclusion).toBe(label);
  const baseline = await get(mediaPath); expect(baseline.contract).toBe("human-result-media-1"); expect(baseline.binding).toEqual(expected); expect(baseline.items).toHaveLength(1); expect(baseline.items[0].receipt.artifact_id).toBe(baselineId); expect(baseline.items[0].receipt_digest).toBe(baselineReceipt); expect(baseline.items[0].receipt.input.filename).not.toBe(filename);
  const pickerMeasurements = [];
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 740 }]) {
    const phone = await browser.newPage({ viewport }); track(phone); const controls = await picker(phone, viewport.width); pickerMeasurements.push({ viewport, ...controls.bounds });
    await controls.close.click(); await expect(controls.dialog).toHaveCount(0); await expect(phone.getByRole("button", { name: "Add image", exact: true })).toBeFocused(); expect(writes).toHaveLength(0); await phone.close();
  }
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); track(desktop); const controls = await picker(desktop, 1440);
  // The only write gesture in this script. An unexpected outcome stops; no replay/replacement.
  await controls.upload.click(); await expect(controls.dialog.getByText("Image added to this report.", { exact: true })).toBeVisible({ timeout: 15000 });
  expect(writes.map(item => item.method)).toEqual(["POST", "PUT", "POST"]); expect(savedIntent).not.toBe(null); const { operation_id: operation, create } = savedIntent;
  const operationPath = `/api/human/result-media-uploads/${operation}`;
  expect(writes.map(item => item.path)).toEqual([`${mediaPath}-uploads`, `${operationPath}/content`, `${operationPath}/finalize`]);
  for (const item of writes) expect(item.csrf).toBe("1"); expect(writes[1]).toMatchObject({ digest: inputDigest, bytes: bytes.length, mime: "image/png" }); expect(writes[2]).toMatchObject({ digest: sha("{}"), bytes: 2 });
  expect(create).toEqual({ operation_id: operation, input_digest: inputDigest, input_bytes: bytes.length, filename, capture: null });
  const committed = new URL(savedIntent.committed_url).searchParams; expect(committed.get("media_upload")).toBe(operation); expect(committed.get("media_actor")).toBe(actor); expect(committed.get("media_request")).toBe(savedIntent.request_digest); expect(committed.get("media_recipe")).toBe("1");
  recoveryUrl = new URL(desktop.url()); expect(recoveryUrl.searchParams.toString()).toBe(committed.toString());
  const status = await get(operationPath); expect(status.operation_id).toBe(operation); expect(status.actor_id).toBe(actor); expect(status.request_digest).toBe(savedIntent.request_digest); expect(status.binding).toEqual(expected); expect(status.state).toBe("retained"); expect(status.capture).toBe(null); expect(status.input).toEqual({ digest: inputDigest, bytes: bytes.length, filename }); expect(status.recovery.put_allowed).toBe(false); expect(status.recovery.finalize_allowed).toBe(false);
  const artifact = status.artifact, receipt = artifact.receipt; expect(receipt.artifact_id).toBe(operation); expect(receipt.uploader_id).toBe(actor); expect(receipt.binding).toEqual(expected); expect(receipt.input).toEqual(status.input); expect(receipt.capture).toBe(null); expect(receipt.rendering_policy).toBe("aq.png.rgba8-srgb-v1"); expect(artifact.receipt_digest).toBe(sha(canonical(receipt))); expect(receipt.variants.render).toMatchObject({ width: dimensions.width, height: dimensions.height, mime: "image/png" });
  const after = await get(mediaPath); expect(after.binding).toEqual(expected); expect(after.items).toHaveLength(2); expect(after.items.find(item => item.receipt.artifact_id === baselineId).receipt_digest).toBe(baselineReceipt); expect(after.items.find(item => item.receipt.artifact_id === operation).receipt_digest).toBe(artifact.receipt_digest);
  const directProof = {};
  for (const variant of ["preview", "render"]) { const descriptor = receipt.variants[variant], response = await api.get(`${mediaPath}/${operation}/content?variant=${variant}`), headers = response.headers(), content = await response.body(); expect(response.status()).toBe(200); expect(headers["content-type"]).toBe("image/png"); expect(headers["content-length"]).toBe(String(descriptor.bytes)); expect(headers["aq-media-digest"]).toBe(descriptor.digest); expect(headers["aq-media-receipt-digest"]).toBe(artifact.receipt_digest); expect(headers["cache-control"]).toMatch(/no-store/); expect(headers["cache-control"]).toMatch(/private/); expect(headers["x-content-type-options"]).toBe("nosniff"); expect(headers["content-disposition"]).toBe("inline"); expect(headers["content-security-policy"]).toBe("default-src 'none'"); expect(content.length).toBe(descriptor.bytes); expect(sha(content)).toBe(descriptor.digest); pngShape(content, descriptor); directProof[variant] = { digest: descriptor.digest, bytes: content.length }; }
  await capture(desktop, "1440-actual-retained-upload.png"); await controls.close.click(); await expect(controls.dialog).toHaveCount(0); await expect(desktop.getByRole("button", { name: "Upload details", exact: true })).toBeFocused();
  const views = [];
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
    const page = viewport.width === 1440 ? desktop : await browser.newPage({ viewport }); if (page !== desktop) { track(page); await page.goto(recoveryUrl.href); const upload = page.getByRole("dialog", { name: "Add supplemental PNG", exact: true }); await expect(upload.getByText("Image added to this report.", { exact: true })).toBeVisible(); const close = upload.getByRole("button", { name: "Close upload", exact: true }); const bounds = await close.boundingBox(); expect(bounds.height).toBeGreaterThanOrEqual(44); expect(bounds.y).toBeGreaterThanOrEqual(0); expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height); await capture(page, `${viewport.width}-actual-retained-upload.png`); await close.click(); }
    await page.locator("[data-result-media]").scrollIntoViewIfNeeded(); const gallery = page.getByRole("region", { name: "Human supplemental images" }); const selector = gallery.getByRole("button", { name: filename, exact: true }); await selector.click(); await expect(selector).toHaveAttribute("aria-pressed", "true"); const preview = await blobProof(gallery.getByRole("img"), receipt.variants.preview); await capture(page, `${viewport.width}-actual-new-preview.png`);
    await gallery.getByRole("button", { name: "Expand image", exact: true }).click(); const modal = page.getByRole("dialog", { name: "Expanded supplemental image", exact: true }); const render = await blobProof(modal.getByRole("img"), receipt.variants.render); await capture(page, `${viewport.width}-actual-new-expanded.png`); const close = modal.getByRole("button", { name: "Close image", exact: true }); await expect(close).toBeVisible(); await close.click(); await expect(modal).toHaveCount(0);
    await gallery.getByRole("button", { name: "Refresh images", exact: true }).click(); await blobProof(gallery.getByRole("img"), receipt.variants.preview); await page.reload(); const recovered = page.getByRole("dialog", { name: "Add supplemental PNG", exact: true }); await expect(recovered.getByText("Image added to this report.", { exact: true })).toBeVisible(); expect(writes).toHaveLength(3); await recovered.getByRole("button", { name: "Close upload", exact: true }).click();
    expect(await page.evaluate(name => [...Object.values(localStorage), ...Object.values(sessionStorage)].some(value => value.includes(name)), filename)).toBe(false);
    if (viewport.width < 768) { const nav = page.getByRole("navigation", { name: "Primary (compact)", exact: true }); await nav.getByRole("link", { name: "Overview", exact: true }).click(); await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible(); await page.goBack(); await expect(page.getByRole("heading", { name: label, exact: true })).toBeVisible(); }
    views.push({ viewport, preview, render }); await page.close();
  }
  const final = await get(mediaPath); expect(final.items).toHaveLength(2); expect(final.items.find(item => item.receipt.artifact_id === operation).receipt_digest).toBe(artifact.receipt_digest); expect(final.items.find(item => item.receipt.artifact_id === baselineId).receipt_digest).toBe(baselineReceipt); expect(writes).toHaveLength(3); expect(errors).toEqual([]); expect(external).toEqual([]);
  admitted = { operation_id: operation, request_digest: savedIntent.request_digest, receipt_digest: artifact.receipt_digest, input: status.input, state: status.state };
  const result = { passed: true, source_only: false, qualification: "One actual human supplemental PNG upload through the compiled Results DOM file input/button, current Owner, SQL/private files and six existing routes", origin: origin.origin, served_bundle_digest: bundleDigest, binding: expected, actor_id: actor, fixture_label: label, baseline: { artifact_id: baselineId, receipt_digest: baselineReceipt, count: 1 }, final_count: 2, original_input_path: inputPath, input_chunks: chunks, input_dimensions: dimensions, admitted, direct_proof: directProof, picker_measurements: pickerMeasurements, views, captures, browser_mutations: writes, observed_responses: observations, external_requests: external, page_errors: errors, elapsed_ms: Math.round(performance.now() - started), limits: "Positive picker/one-submit/retained-gallery/preview/expand/close/reload only. OS picker dialog, response-loss/capability-loss negatives remain separate unit/server qualification. No worker capture, provider or source-coverage/acceptance claim. No API-side writes, retries, replacement UUID, interception or canonical configuration change." };
  await Promise.all(evidenceJobs); await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2) + "\n"); console.log(JSON.stringify(result));
} catch (error) {
  for (const [index, page] of pages.entries()) if (!page.isClosed()) await page.screenshot({ path: join(output, `failure-${index}.png`) }).catch(() => {});
  await Promise.all(evidenceJobs); await writeFile(join(output, "result.json"), JSON.stringify({ passed: false, error: String(error), saved_intent: savedIntent, admitted, recovery_url: recoveryUrl?.href ?? null, browser_mutations: writes, observed_responses: observations, errors, external_requests: external, captures }, null, 2) + "\n"); throw error;
} finally { await api.dispose(); await browser.close(); }
