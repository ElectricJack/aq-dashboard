#!/usr/bin/env node
// ACTUAL disposable AQ Owner only. No interception, fake bootstrap, uploader UI or provider calls.
import { chromium, expect, request } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

function required(name) { const value = process.env[name]; if (!value) throw new Error(`Required disposable fixture setting: ${name}`); return value; }
if (required("AQ_LIVE_ALLOW_MEDIA_UPLOAD") !== "1") throw new Error("One upload requires explicit disposable-fixture opt-in");
const origin = new URL(required("AQ_LIVE_URL"));
if (!["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname) || origin.protocol !== "http:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("Probe requires an explicit loopback fixture origin");
const expected = JSON.parse(required("AQ_LIVE_MEDIA_BINDING")), actor = required("AQ_LIVE_ACTOR_ID");
const label = required("AQ_LIVE_MEDIA_FIXTURE_LABEL"), manifest = required("AQ_LIVE_CANDIDATE_MANIFEST");
expect(label).toMatch(/fixture/i); expect(label.length).toBeGreaterThan(8);
const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
for (const value of [expected.report_id, expected.project_id, expected.task_id, expected.attempt_id, expected.source?.repository_id, actor]) expect(value).toMatch(uuid);
expect(expected.coverage).toBe("recorded_legacy_native_only"); expect(expected.report_revision).toMatch(/^[0-9a-f]{64}$/);
expect(expected.source.base.format).toMatch(/^(sha1|sha256)$/); expect(expected.source.base.hex).toMatch(new RegExp(`^[0-9a-f]{${expected.source.base.format === "sha1" ? 40 : 64}}$`));
expect(Object.keys(expected).sort()).toEqual(["coverage", "report_id", "report_revision", "project_id", "task_id", "attempt_id", "source"].sort());
const output = process.env.AQ_LIVE_OUTPUT_DIR ?? "/tmp/aq-result-media-actual-browser";
const sha = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value !== null && typeof value === "object" ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
const bundleDigest = sha(await readFile(manifest));
const reportPath = `/api/human/results/${expected.report_id}/revisions/${expected.report_revision}`;
const pagePath = `/results/${expected.report_id}/revisions/${expected.report_revision}`;
const mediaPath = `${reportPath}/media`;
await mkdir(output, { recursive: true });
const api = await request.newContext({ baseURL: origin.origin, timeout: 10000, maxRedirects: 0 });
const browser = await chromium.launch({ headless: true });
const started = performance.now(), captures = [], pages = [], errors = [], browserWrites = [], external = [], requests = [], mutations = [];
let admitted = null;
async function get(path) { const response = await api.get(path); expect(response.status(), path).toBe(200); return response.json(); }
async function mutate(method, path, data, mime) {
  mutations.push({ method, path });
  return api.fetch(path, { method, data, headers: { Origin: origin.origin, "X-AQ-Request": "1", "Content-Type": mime } });
}
function assertStatus(status, raw, input, operation) {
  expect(status.contract).toBe("human-result-media-1"); expect(status.operation_id).toBe(operation); expect(status.actor_id).toBe(actor);
  expect(status.request_digest).toBe(sha(raw)); expect(status.binding).toEqual(expected); expect(status.input).toEqual(input); expect(status.capture).toBe(null); expect(status.rejection).toBe(null);
  expect(status.created_at_ms).toBeGreaterThan(0); expect(Number.isSafeInteger(status.created_at_ms)).toBe(true);
  expect(status.upload_expires_at_ms).toBeGreaterThan(status.created_at_ms); expect(status.retain_until_ms).toBeGreaterThan(status.upload_expires_at_ms);
}
function pngShape(bytes, descriptor) {
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])); expect(bytes.toString("ascii", 12, 16)).toBe("IHDR");
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  expect(width).toBeGreaterThan(0); expect(height).toBeGreaterThan(0); expect(width * height).toBeLessThanOrEqual(2000000); expect(Math.max(width, height)).toBeLessThanOrEqual(4096);
  expect(bytes[24]).toBe(8); expect([2, 6]).toContain(bytes[25]); expect(bytes[28]).toBe(0);
  if (descriptor) { expect(width).toBe(descriptor.width); expect(height).toBe(descriptor.height); expect(bytes[25]).toBe(6); }
  return { width, height };
}
function track(page) {
  pages.push(page); page.on("pageerror", error => errors.push(error.message));
  page.on("request", req => { const url = new URL(req.url()); if (!["http:", "https:"].includes(url.protocol)) return; if (url.origin !== origin.origin) external.push(url.origin); if (!["GET", "HEAD"].includes(req.method())) browserWrites.push({ path: url.pathname, method: req.method() }); if (url.pathname.includes("/media")) requests.push({ path: url.pathname, query: url.search, method: req.method() }); });
}
async function capture(page, filename) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), "no page horizontal overflow").toBe(false);
  const path = join(output, filename); await page.screenshot({ path }); captures.push(path);
}
async function blobProof(image, descriptor) {
  await expect(image).toBeVisible(); await expect(image).toHaveAttribute("src", /^blob:/);
  await expect.poll(() => image.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  const fact = await image.evaluate(async img => { const response = await fetch(img.src), bytes = await response.arrayBuffer(); const digest = await crypto.subtle.digest("SHA-256", bytes); return { digest: `sha256:${[...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, "0")).join("")}`, bytes: bytes.byteLength, mime: response.headers.get("Content-Type"), width: img.naturalWidth, height: img.naturalHeight }; });
  expect(fact).toEqual({ digest: descriptor.digest, bytes: descriptor.bytes, mime: "image/png", width: descriptor.width, height: descriptor.height });
  return fact;
}
try {
  const bootstrap = await get("/api/v1/bootstrap"); expect(bootstrap.data.principal.id).toBe(actor); expect(bootstrap.data.product.dashboard_digest).toBe(bundleDigest);
  for (const name of ["results.read", "results.media.read", "results.media.upload"]) expect(bootstrap.data.capabilities.some(cap => cap.name === name && cap.version === "1" && cap.enabled === true), name).toBe(true);
  const metadata = await get(reportPath); expect(metadata.coverage).toBe(expected.coverage); expect(metadata.items).toHaveLength(1); const row = metadata.items[0];
  expect({ coverage: metadata.coverage, report_id: row.report_id, report_revision: row.revision, project_id: row.project_id, task_id: row.task_id, attempt_id: row.attempt_id, source: { repository_id: row.repository_id, base: row.source_base } }).toEqual(expected);
  expect(row.conclusion, "fixture label independently retained by API06").toBe(label);
  const initial = await get(mediaPath); expect(initial.contract).toBe("human-result-media-1"); expect(initial.binding).toEqual(expected); expect(initial.items, "fresh disposable fixture has no previous upload").toEqual([]);
  const source = await browser.newPage({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 1 }); track(source); await source.goto(new URL(pagePath, origin).href);
  await expect(source.getByRole("heading", { name: label, exact: true })).toBeVisible();
  const inputPath = join(output, "aq-disposable-fixture.png"); const bytes = await source.screenshot({ path: inputPath, type: "png" });
  const dimensions = pngShape(bytes); expect(bytes.length).toBeLessThanOrEqual(1048576); expect(dimensions).toEqual({ width: 960, height: 600 }); await source.close();
  const operation = randomUUID(), input = { digest: sha(bytes), bytes: bytes.length, filename: "aq-disposable-fixture.png" };
  const create = { operation_id: operation, input_digest: input.digest, input_bytes: input.bytes, filename: input.filename, capture: null };
  const raw = Buffer.from(JSON.stringify(create)); await writeFile(join(output, "upload-create.json"), raw);
  const reservationResponse = await mutate("POST", `${reportPath}/media-uploads`, raw, "application/json"); expect(reservationResponse.status()).toBe(201);
  const reservation = await reservationResponse.json(); assertStatus(reservation, raw, input, operation); expect(reservation.state).toBe("reserved"); expect(reservation.artifact).toBe(null); expect(reservation.recovery.put_allowed).toBe(true);
  const operationPath = `/api/human/result-media-uploads/${operation}`;
  const putResponse = await mutate("PUT", `${operationPath}/content`, bytes, "image/png"); expect(putResponse.status()).toBe(200); const received = await putResponse.json(); assertStatus(received, raw, input, operation); expect(received.state).toBe("received"); expect(received.recovery.finalize_allowed).toBe(true);
  const finalizeResponse = await mutate("POST", `${operationPath}/finalize`, Buffer.from("{}"), "application/json"); expect([200, 202]).toContain(finalizeResponse.status());
  let status = await finalizeResponse.json(); assertStatus(status, raw, input, operation);
  // A pure lookup may observe an asynchronously finishing job. Never issue a replacement/recovery mutation.
  for (let attempt = 0; status.state === "finalizing" && attempt < 20; attempt++) { await new Promise(resolve => setTimeout(resolve, 100)); status = await get(operationPath); assertStatus(status, raw, input, operation); }
  expect(status.state).toBe("retained"); expect(status.recovery.put_allowed).toBe(false); expect(status.recovery.finalize_allowed).toBe(false);
  const artifact = status.artifact, receipt = artifact.receipt;
  expect(artifact.receipt_digest).toBe(sha(canonical(receipt))); expect(receipt.binding).toEqual(expected); expect(receipt.artifact_id).toBe(operation); expect(receipt.uploader_id).toBe(actor); expect(receipt.input).toEqual(input); expect(receipt.capture).toBe(null); expect(receipt.rendering_policy).toBe("aq.png.rgba8-srgb-v1"); expect(receipt.retain_until_ms).toBe(status.retain_until_ms);
  expect(receipt.variants.render).toMatchObject({ width: 960, height: 600, mime: "image/png" }); expect(receipt.variants.preview).toMatchObject({ width: 384, height: 240, mime: "image/png" });
  const listing = await get(mediaPath); expect(listing.binding).toEqual(expected); expect(listing.items).toHaveLength(1); expect(listing.items[0].receipt).toEqual(receipt); expect(listing.items[0].receipt_digest).toBe(artifact.receipt_digest); expect(listing.items[0].availability.state).toBe("available");
  const directProof = {};
  for (const variant of ["preview", "render"]) {
    const descriptor = receipt.variants[variant], response = await api.get(`${mediaPath}/${operation}/content?variant=${variant}`); expect(response.status()).toBe(200); const headers = response.headers(), body = await response.body();
    expect(headers["content-type"]).toBe("image/png"); expect(headers["content-length"]).toBe(String(descriptor.bytes)); expect(headers["aq-media-digest"]).toBe(descriptor.digest); expect(headers["aq-media-receipt-digest"]).toBe(artifact.receipt_digest); expect(headers["cache-control"]).toMatch(/private/); expect(headers["cache-control"]).toMatch(/no-store/); expect(headers["x-content-type-options"]).toBe("nosniff"); expect(headers["content-disposition"]).toBe("inline"); expect(headers["content-security-policy"]).toBe("default-src 'none'"); expect(body.length).toBe(descriptor.bytes); expect(sha(body)).toBe(descriptor.digest); pngShape(body, descriptor); directProof[variant] = { digest: descriptor.digest, bytes: body.length };
  }
  const views = [];
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
    const page = await browser.newPage({ viewport }); track(page); await page.goto(new URL(pagePath, origin).href); await expect(page.getByRole("heading", { name: label, exact: true })).toBeVisible();
    await page.locator("[data-result-media]").scrollIntoViewIfNeeded(); const gallery = page.getByRole("region", { name: "Human supplemental images" });
    const selector = gallery.getByRole("button", { name: input.filename, exact: true }); await expect(selector).toHaveAttribute("aria-pressed", "true"); await selector.click();
    const preview = await blobProof(gallery.getByRole("img"), receipt.variants.preview); await expect(gallery.getByText("Uploaded by a human. Capture details are unverified.", { exact: true })).toBeVisible(); await capture(page, `${viewport.width}-actual-preview.png`);
    const expand = gallery.getByRole("button", { name: "Expand image", exact: true }); await expand.click(); const modal = page.getByRole("dialog", { name: "Expanded supplemental image" });
    const render = await blobProof(modal.getByRole("img"), receipt.variants.render); const close = modal.getByRole("button", { name: "Close image", exact: true }); await expect(close).toBeVisible();
    const closeBounds = await close.boundingBox(); expect(closeBounds.y).toBeGreaterThanOrEqual(0); expect(closeBounds.y + closeBounds.height).toBeLessThanOrEqual(viewport.height); await capture(page, `${viewport.width}-actual-expanded.png`);
    await close.click(); await expect(modal).toHaveCount(0); await expect(expand).toBeFocused(); await gallery.getByRole("button", { name: "Refresh images", exact: true }).click(); await blobProof(gallery.getByRole("img"), receipt.variants.preview);
    await page.getByRole("button", { name: "Refresh results", exact: true }).click(); await page.reload(); await page.locator("[data-result-media]").scrollIntoViewIfNeeded(); await blobProof(page.getByRole("region", { name: "Human supplemental images" }).getByRole("img"), receipt.variants.preview);
    if (viewport.width < 768) { const nav = page.getByRole("navigation", { name: "Primary (compact)", exact: true }); await nav.getByRole("link", { name: "Overview", exact: true }).click(); await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible(); await page.goBack(); await expect(page.getByRole("heading", { name: label, exact: true })).toBeVisible(); }
    views.push({ viewport, preview, render, close_bounds: closeBounds }); await page.close();
  }
  const final = await get(mediaPath); expect(final.items.map(item => item.receipt_digest)).toEqual([artifact.receipt_digest]); expect((await get(operationPath)).artifact.receipt_digest).toBe(artifact.receipt_digest);
  expect(browserWrites).toEqual([]); expect(mutations.map(item => item.method)).toEqual(["POST", "PUT", "POST"]); expect(external).toEqual([]); expect(errors).toEqual([]);
  admitted = { operation_id: operation, artifact_id: receipt.artifact_id, request_digest: status.request_digest, receipt_digest: artifact.receipt_digest, input, dimensions, state: status.state };
  const result = { passed: true, source_only: false, origin: origin.origin, qualification: "Actual disposable AQ Owner/SQL/private PNG storage and actual compiled client; one explicit human-supplemental upload", served_bundle_digest: bundleDigest, binding: expected, actor_id: actor, fixture_label: label, admitted, direct_proof: directProof, views, captures, input_capture: inputPath, mutations, browser_mutations: browserWrites, external_requests: external, page_errors: errors, media_reads: requests, elapsed_ms: Math.round(performance.now() - started), references: ["10-results-desktop-v2.png", "13-results-mobile-v2.png"], limits: "Positive read/selector/expand/close/refresh/reload only. Authorization/expiry/late-result negatives qualified separately. No worker capture/source coverage/acceptance/provider claim. Listing availability alone is not SHA proof." };
  await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2) + "\n"); console.log(JSON.stringify(result));
} catch (error) {
  for (const [index, page] of pages.entries()) if (!page.isClosed()) await page.screenshot({ path: join(output, `failure-${index}.png`) }).catch(() => {});
  await writeFile(join(output, "result.json"), JSON.stringify({ passed: false, source_only: false, error: String(error), admitted, captures, errors, mutations, browser_mutations: browserWrites, external_requests: external }, null, 2) + "\n"); throw error;
} finally { await api.dispose(); await browser.close(); }
