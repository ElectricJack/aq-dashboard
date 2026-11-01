#!/usr/bin/env node
// SOURCE UI ONLY. Every API below is intercepted synthetic fixture data.
// This does not test a mounted AQ owner, authorized files or actual HTTP bytes.
import { chromium, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
const origin = new URL(process.env.AQ_SOURCE_UI_URL ?? "http://127.0.0.1:4210");
const output = process.env.AQ_SOURCE_UI_OUTPUT ?? "/tmp/aq-result-media-source-visual";
const hash = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const canonical = value => value && typeof value === "object" && !Array.isArray(value) ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}` : JSON.stringify(value);
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true }), raster = await browser.newPage();
async function pixels(width, height, name) {
  return raster.evaluate(({ width, height, name }) => {
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height; const c = canvas.getContext("2d");
    c.fillStyle = "#10151c"; c.fillRect(6, 6, width - 12, height - 12); c.fillStyle = "#b4a9ff"; c.fillRect(28, 28, width - 56, 66);
    c.fillStyle = "#121523"; c.font = "bold 25px sans-serif"; c.fillText("SYNTHETIC SOURCE UI", 44, 69);
    c.fillStyle = "#edf2ff"; c.font = "bold 28px sans-serif"; c.fillText(name, 30, 144);
    c.fillStyle = "#aebbd0"; c.font = "18px sans-serif"; c.fillText("Illustrative media fixture — no live AQ data", 30, 183);
    const count = height > width ? 4 : 2, gap = 22, cardHeight = Math.floor((height - 260 - gap * count) / count);
    for (let n = 0; n < count; n++) { const y = 215 + n * (cardHeight + gap); c.fillStyle = "#202a37"; c.fillRect(30, y, width - 60, cardHeight); c.fillStyle = "#b4a9ff"; c.fillRect(46, y + 18, 8, cardHeight - 36); c.fillStyle = "#edf2ff"; c.font = "bold 21px sans-serif"; c.fillText(`Example panel ${n + 1}`, 76, y + 43); c.fillStyle = "#aebbd0"; c.font = "17px sans-serif"; c.fillText("Preview rendering only", 76, y + 75); }
    return [...c.getImageData(0, 0, width, height).data];
  }, { width, height, name });
}
function chunk(kind, bytes) {
  const body = Buffer.concat([Buffer.from(kind), Buffer.from(bytes)]); let crc = 0xffffffff;
  for (const byte of body) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; }
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4); length.writeUInt32BE(bytes.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0); return Buffer.concat([length, body, checksum]);
}
function png(width, height, rgba) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height); for (let y = 0; y < height; y++) Buffer.from(rgba.slice(y * width * 4, (y + 1) * width * 4)).copy(rows, y * (width * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("sRGB", [0]), chunk("IDAT", deflateSync(rows)), chunk("IEND", [])]);
}
const files = [];
for (const [index, dims] of [[960, 600, "Desktop layout"], [600, 960, "Phone layout"]].entries()) {
  const [width, height, name] = dims, rgba = await pixels(width, height, name), longest = Math.max(width, height), pw = Math.floor(width * 384 / longest), ph = Math.floor(height * 384 / longest), preview = [];
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) { const offset = (Math.floor(y * height / ph) * width + Math.floor(x * width / pw)) * 4; preview.push(...rgba.slice(offset, offset + 4)); }
  files.push({ id: id(201 + index), filename: index ? "Synthetic phone.png" : "Synthetic desktop.png", preview: { bytes: png(pw, ph, preview), width: pw, height: ph }, render: { bytes: png(width, height, rgba), width, height } });
}
await raster.close();
const originalBootstrap = JSON.parse(await readFile(new URL("../contracts/proposed/bootstrap.json", import.meta.url), "utf8"));
const now = Date.now(), binding = { coverage: "recorded_legacy_native_only", report_id: id(1), report_revision: "a".repeat(64), project_id: id(100), task_id: id(101), attempt_id: id(102), source: { repository_id: id(103), base: { format: "sha1", hex: "b".repeat(40) } } };
const record = { report_id: binding.report_id, revision: binding.report_revision, project_id: binding.project_id, task_id: binding.task_id, attempt_id: binding.attempt_id, recorded_at_ms: now - 60000, conclusion: "Synthetic source UI · Responsive workspace", process_outcome: "unknown", current_report_head: true, head_report_id: binding.report_id, supersedes: null, repository_id: binding.source.repository_id, source_base: binding.source.base, source_receipt_ids: [], pending_effect_ids: [] };
const limits = { max_input_bytes: 1048576, max_render_bytes: 8388608, max_preview_bytes: 786432, max_pixels: 2000000, max_dimension: 4096, max_result_artifacts: 8, upload_ttl_ms: 1800000, retention_ms: 604800000 };
function artifact(file, expiry = false) {
  const receipt = { schema_version: 1, artifact_id: file.id, binding, uploader_id: id(900), input: { digest: hash(file.render.bytes), bytes: file.render.bytes.length, filename: file.filename }, capture: null, rendering_policy: "aq.png.rgba8-srgb-v1", variants: Object.fromEntries(["preview", "render"].map(name => [name, { digest: hash(file[name].bytes), bytes: file[name].bytes.length, mime: "image/png", width: file[name].width, height: file[name].height }])), retained_at_ms: now - 3600000, retain_until_ms: expiry ? now + 900 : now + 86400000 };
  return { receipt, receipt_digest: hash(canonical(receipt)), availability: { state: "available", observed_at_ms: now, reason: null } };
}
const captures = [], errors = [], unexpected = [], binaryReads = [];
async function sourcePage(viewport, expiry = false) {
  const page = await browser.newPage({ viewport });
  page.on("pageerror", error => errors.push(error.message));
  await page.route(`${origin.origin}/api/**`, async route => {
    const url = new URL(route.request().url()); if (url.origin !== origin.origin) { unexpected.push(url.href); return route.abort(); }
    const path = url.pathname;
    if (path === "/api/v1/bootstrap") return route.fulfill({ json: { ...originalBootstrap, api_version: "dashboard-read-1", data: { ...originalBootstrap.data, principal: { id: id(900), display_name: "Synthetic source UI", authorization_revision: "1" }, product: { version: "synthetic-source-ui-not-a-release", dashboard_digest: "source-only:no-production-build" }, capabilities: [{ name: "results.read", version: "1", enabled: true }, { name: "results.media.read", version: "1", enabled: true }], global_supervisor: { status: "unconfigured", conversation_id: null } } } });
    if (path === "/api/human/results" || path === `/api/human/results/${binding.report_id}/revisions/${binding.report_revision}`) return route.fulfill({ json: { schema_version: 1, server_time_ms: now, coverage: binding.coverage, items: [record], next_after: null } });
    if (path.endsWith("/media")) return route.fulfill({ json: { contract: "human-result-media-1", server_time_ms: now, binding, limits, items: files.map(file => artifact(file, expiry)) } });
    if (path.endsWith("/content")) {
      const file = files.find(file => path.includes(file.id)), variant = url.searchParams.get("variant"), descriptor = artifact(file, expiry); binaryReads.push({ width: viewport.width, variant });
      return route.fulfill({ body: file[variant].bytes, headers: { "Content-Type": "image/png", "Content-Length": String(file[variant].bytes.length), "AQ-Media-Digest": hash(file[variant].bytes), "AQ-Media-Receipt-Digest": descriptor.receipt_digest, "Cache-Control": "private, no-store" } });
    }
    unexpected.push(path); return route.fulfill({ status: 503, json: { error: "source_fixture_only", message: "No actual AQ request is permitted by this source renderer" } });
  });
  return page;
}
async function capture(page, name) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false); const path = join(output, name); await page.screenshot({ path }); captures.push(path); }
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
    const page = await sourcePage(viewport); await page.goto(new URL("/results", origin).href);
    await page.locator("[data-result-media]").first().scrollIntoViewIfNeeded();
    const gallery = page.getByRole("region", { name: "Human supplemental images" }); await expect(gallery.getByRole("img")).toBeVisible();
    await expect(page.getByRole("heading", { name: record.conclusion, exact: true })).toBeVisible();
    await capture(page, `${viewport.width}-source-feed.png`);
    await gallery.getByRole("button", { name: "Synthetic phone.png", exact: true }).click(); await expect(gallery.getByRole("img")).toHaveAttribute("alt", "Human supplemental Synthetic phone.png");
    await gallery.getByRole("button", { name: "Expand image", exact: true }).click(); const modal = page.getByRole("dialog", { name: "Expanded supplemental image" }); await expect(modal.getByRole("img")).toBeVisible();
    await capture(page, `${viewport.width}-source-expanded.png`);
    const close = modal.getByRole("button", { name: "Close image", exact: true }); await expect(close).toBeVisible(); await close.click(); await expect(modal).toHaveCount(0);
    await expect(gallery.getByRole("button", { name: "Expand image", exact: true })).toBeFocused();
    if (viewport.width < 768) { const nav = page.getByRole("navigation", { name: "Primary (compact)", exact: true }); await nav.getByRole("link", { name: "Overview", exact: true }).click(); await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible(); await page.goBack(); await expect(page.getByRole("heading", { name: "Results", exact: true })).toBeVisible(); }
    await page.close();
  }
  const expired = await sourcePage({ width: 390, height: 844 }, true); await expired.goto(new URL("/results", origin).href);
  const gallery = expired.getByRole("region", { name: "Human supplemental images" }); await expect(gallery.getByRole("img")).toBeVisible();
  await expect(gallery.getByText("Image expired. Refresh images to inspect current retention.", { exact: true })).toBeVisible(); await expect(gallery.getByRole("img")).toHaveCount(0); await capture(expired, "390-source-expired.png");
  expect(errors).toEqual([]); expect(unexpected).toEqual([]);
  const result = { passed: true, qualification: "SYNTHETIC SOURCE UI ONLY — intercepted fixture APIs; actual owner/HTTP/files/retention/provenance remain unqualified", origin: origin.origin, references: ["10-results-desktop-v2.png", "13-results-mobile-v2.png"], captures, errors, unexpected, binary_reads: binaryReads, source_only: true, production_build: false };
  await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2) + "\n"); console.log(JSON.stringify(result));
} catch (error) { for (const [index, page] of browser.contexts().flatMap(context => context.pages()).entries()) if (!page.isClosed()) await page.screenshot({ path: join(output, `failure-${index}.png`) }).catch(() => {}); await writeFile(join(output, "result.json"), JSON.stringify({ passed: false, source_only: true, error: String(error), errors, unexpected }, null, 2) + "\n"); throw error; }
finally { await browser.close(); }
