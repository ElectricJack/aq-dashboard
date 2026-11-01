#!/usr/bin/env node
// Actual compiled bundle and protected owner only; explicit empty/nonempty modes.
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
const origin = new URL(process.env.AQ_LIVE_URL ?? "");
const session = process.env.AQ_LIVE_SESSION_ID, digest = process.env.AQ_LIVE_BUNDLE_MANIFEST_SHA256;
const mode = process.env.AQ_LIVE_EVENTS_EXPECT, requireGap = process.env.AQ_LIVE_EVENTS_REQUIRE_GAP === "1";
if (!["http:", "https:"].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("Explicit human-listener origin required");
if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(session ?? "") || !/^[0-9a-f]{64}$/.test(digest ?? "") || !["empty", "nonempty"].includes(mode)) throw new Error("Exact session, bundle digest and explicit empty/nonempty expectation required");
const output = process.env.AQ_LIVE_OUTPUT_DIR ?? "/tmp/aq-session-events-browser";
await mkdir(output, { recursive: true }); const started = performance.now();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } }); page.setDefaultTimeout(6000);
const errors = [], mutations = [], foreign = [], browserReads = [], captures = [];
page.on("pageerror", error => errors.push(error.message));
page.on("request", request => {
  const url = new URL(request.url());
  if (url.origin !== origin.origin) foreign.push(url.origin);
  if (!["GET", "HEAD"].includes(request.method())) mutations.push({ method: request.method(), path: url.pathname });
  if (/\/api\/observations\/sessions\/[^/]+\/events$/.test(url.pathname)) browserReads.push({ path: url.pathname, after: url.searchParams.get("after_sequence"), through: url.searchParams.get("through_sequence"), limit: url.searchParams.get("limit") });
});
async function actual(path) {
  const response = await page.request.get(new URL(path, origin).href, { timeout: 5000, maxRedirects: 0 });
  expect(response.status()).toBe(200); return response.json();
}
async function shot(name) { const path = join(output, name); await page.screenshot({ path }); captures.push(path); }
async function noOverflow() { expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false); }
async function readPosition(region, width) {
  await region.evaluate(element => element.scrollIntoView({ block: "start" }));
  if (width >= 768) await page.evaluate(() => window.scrollBy(0, -90));
}
try {
  const bootstrap = await actual("/api/v1/bootstrap");
  expect(bootstrap.api_version).toBe("dashboard-read-1");
  expect(bootstrap.data.product.dashboard_digest).toBe(`sha256:${digest}`);
  expect(bootstrap.data.capabilities.find(cap => cap.name === "session.events.read")).toMatchObject({ version: "1", enabled: true });
  const detail = await actual(`/api/v1/sessions/${session}`), binding = detail.data.observation_binding;
  expect(detail.data.id).toBe(session); expect(binding?.session.session_id).toBe(session);
  expect(binding.project_id).toBe(detail.data.project.id); expect(binding.task_id).toBe(detail.data.task.id); expect(binding.attempt_id).toBe(detail.data.attempt_id);
  const actualRows = [], pages = []; let after = 0, through;
  for (let index = 0; index < 4; index++) {
    const params = new URLSearchParams({ after_sequence: String(after), limit: "16" });
    if (through !== undefined) params.set("through_sequence", String(through));
    const value = await actual(`/api/observations/sessions/${binding.attempt_id}/events?${params}`);
    expect(value.schema_version).toBe(1); expect(value.binding).toEqual(binding); expect(value.after_sequence).toBe(after);
    if (through !== undefined) expect(value.through_sequence).toBe(through); through = value.through_sequence;
    expect(value.events.length).toBeLessThanOrEqual(16);
    for (const item of value.events) { expect(item.record.body.binding).toEqual(binding); expect(item.record.body.sequence).toBeGreaterThan(after); expect(item.record.body.sequence).toBeLessThanOrEqual(through); }
    actualRows.push(...value.events); pages.push(value);
    if (value.next_after === null) break; after = value.next_after;
  }
  expect(actualRows.length === 0).toBe(mode === "empty");
  if (requireGap) expect(actualRows.some(row => row.record.body.kind.kind === "gap")).toBe(true);
  await page.goto(new URL(`/agents/${session}`, origin).href, { waitUntil: "networkidle" });
  await expect(page.getByRole("button", { name: "Session details", exact: true })).toBeVisible(); expect(browserReads).toHaveLength(0);
  await shot("agents-desktop-closed.png");
  await page.getByRole("button", { name: "Session details", exact: true }).click();
  const region = page.getByRole("region", { name: "Session source events", exact: true }); await expect(region).toBeVisible(); expect(browserReads).toHaveLength(0);
  await region.getByRole("button", { name: "Load source events", exact: true }).click();
  await expect(region.getByText(`${pages[0].events.length} reports loaded · through node sequence ${through}`, { exact: true })).toBeVisible();
  for (let index = 1; index < pages.length; index++) {
    await region.getByRole("button", { name: "Load more source events", exact: true }).click();
    await expect(region.getByRole("list", { name: "Recorded source events", exact: true }).getByRole("listitem")).toHaveCount(pages.slice(0, index + 1).reduce((sum, value) => sum + value.events.length, 0));
  }
  const list = region.getByRole("list", { name: "Recorded source events", exact: true });
  await expect(list.getByRole("listitem")).toHaveCount(actualRows.length);
  if (mode === "empty") await expect(region.getByText("No source reports were recorded for this session in this retained snapshot.", { exact: true })).toBeVisible();
  else {
    for (let index = 0; index < actualRows.length; index++) {
      const item = actualRows[index], row = list.getByRole("listitem").nth(index);
      await row.locator("summary").click(); await expect(row.getByText(`${item.record.event_id} · ${item.record.body.sequence}`, { exact: true })).toBeVisible();
      await expect(row.getByText(item.record.body_digest, { exact: true })).toBeVisible();
      await expect(row.getByText(item.record.body.provenance.source_id, { exact: true })).toBeVisible();
      if (item.record.body.kind.kind === "gap") await expect(row.getByText(`Source gap · ${item.record.body.kind.reason.replaceAll("_", " ")}`, { exact: true })).toBeVisible();
      await row.locator("summary").click();
    }
  }
  await readPosition(region, 1440); await noOverflow(); await shot("source-events-desktop.png");
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 }); await readPosition(region, width); await noOverflow(); await shot(`source-events-${width}.png`);
    if (actualRows.length > 0) { const row = list.getByRole("listitem").first(); await row.locator("summary").click(); await readPosition(row, width); await noOverflow(); await shot(`source-provenance-${width}.png`); await row.locator("summary").click(); }
    await page.evaluate(() => window.scrollTo(0, 0)); await expect(page.getByRole("link", { name: "All sessions", exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Primary (compact)", exact: true })).toBeHidden();
  }
  await region.getByRole("button", { name: "Refresh snapshot", exact: true }).click();
  await expect(region.getByText(`${pages[0].events.length} reports loaded · through node sequence ${through}`, { exact: true })).toBeVisible();
  expect(browserReads.at(-1)).toMatchObject({ after: "0", through: null, limit: "16" });
  for (const read of browserReads) expect(read.path).toBe(`/api/observations/sessions/${binding.attempt_id}/events`);
  await page.evaluate(() => window.scrollTo(0, 0)); await page.getByRole("link", { name: "All sessions", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Agents", exact: true })).toBeVisible();
  expect(errors).toEqual([]); expect(mutations).toEqual([]); expect(foreign).toEqual([]);
  const result = { passed: true, origin: origin.origin, session_id: session, attempt_id: binding.attempt_id, mode,
    served_bundle_digest: bootstrap.data.product.dashboard_digest, loaded_reports: actualRows.length, pages: pages.length, through_sequence: through,
    explicit_gaps: actualRows.filter(row => row.record.body.kind.kind === "gap").length,
    require_gap: requireGap, reports: actualRows.map(row => ({ event_id: row.record.event_id, sequence: row.record.body.sequence, kind: row.record.body.kind.kind })),
    browser_reads: browserReads, mutations, foreign_requests: foreign, page_errors: errors, viewports: [1440, 390, 320], captures,
    elapsed_ms: Math.round(performance.now() - started), note: "Actual exact-session owner and verified compiled bundle, explicit empty/nonempty mode. No interception, row/content fetch, Watch, control, provider/health/current-accounting or complete-transcript claim." };
  await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2) + "\n"); console.log(JSON.stringify(result));
} catch (error) {
  await page.screenshot({ path: join(output, "failure.png") }).catch(() => undefined);
  await writeFile(join(output, "result.json"), JSON.stringify({ passed: false, error: String(error), mode, browser_reads: browserReads, mutations, foreign_requests: foreign, page_errors: errors }, null, 2) + "\n"); throw error;
} finally { await browser.close(); }
