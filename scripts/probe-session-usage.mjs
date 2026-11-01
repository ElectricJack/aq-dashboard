#!/usr/bin/env node
// Actual mounted AQ observation API only: read-only, no interception or fixture writes.
import { chromium, expect, request } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const origin = new URL(process.env.AQ_LIVE_URL ?? "http://localhost:4196");
const sessionId = process.env.AQ_LIVE_SESSION_ID ?? "9767942b-b7f8-5ae4-be04-136f81509cce";
const expectedBinding = process.env.AQ_LIVE_USAGE_BINDING ? JSON.parse(process.env.AQ_LIVE_USAGE_BINDING) : null;
const expectedRevision = process.env.AQ_LIVE_USAGE_REVISION ? Number(process.env.AQ_LIVE_USAGE_REVISION) : null;
const expectedSubtotals = process.env.AQ_LIVE_USAGE_SUBTOTALS ? JSON.parse(process.env.AQ_LIVE_USAGE_SUBTOTALS) : null;
const output = process.env.AQ_LIVE_OUTPUT_DIR ?? "/tmp/aq-session-usage-browser";
await mkdir(output, { recursive: true });
const started = performance.now();
const browser = await chromium.launch({ headless: true });
const api = await request.newContext();
const errors = [], mutations = [], usageReads = [], captures = [];
const pages = [];
async function read(path) {
  const response = await api.get(new URL(path, origin).href);
  expect(response.status(), path).toBe(200);
  return response.json();
}
async function capture(page, name, fullPage = false) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), "no whole-page horizontal overflow").toBe(false);
  const path = join(output, name);
  await page.screenshot({ path, fullPage }); captures.push(path);
}
try {
  const bootstrap = await read("/api/v1/bootstrap");
  expect(bootstrap.data.capabilities.some(cap => cap.name === "session.usage.read" && cap.version === "1" && cap.enabled === true)).toBe(true);
  const detail = (await read(`/api/v1/sessions/${encodeURIComponent(sessionId)}`)).data;
  expect(detail.id).toBe(sessionId);
  const binding = detail.observation_binding;
  expect(binding?.session.session_id).toBe(sessionId);
  expect(binding.project_id).toBe(detail.project.id); expect(binding.task_id).toBe(detail.task.id); expect(binding.attempt_id).toBe(detail.attempt_id);
  if (process.env.AQ_LIVE_ATTEMPT_ID) expect(binding.attempt_id).toBe(process.env.AQ_LIVE_ATTEMPT_ID);
  if (process.env.AQ_LIVE_PROJECT_ID) expect(binding.project_id).toBe(process.env.AQ_LIVE_PROJECT_ID);
  if (expectedBinding) expect(binding).toEqual(expectedBinding);
  const usage = await read(`/api/observations/sessions/${encodeURIComponent(binding.attempt_id)}/usage`);
  expect(usage.schema_version).toBe(1); expect(usage.binding).toEqual(binding);
  expect(usage.usage.costs).toEqual([{ kind: "unknown", reason: "not_reported" }]);
  if (expectedRevision !== null) { expect(Number.isSafeInteger(expectedRevision)).toBe(true); expect(usage.revision).toBe(expectedRevision); }
  if (expectedSubtotals) {
    expect(usage.known_category_subtotals).toEqual(expectedSubtotals);
    expect(usage.revision).toBeGreaterThan(0); expect(usage.usage.completeness.kind).toBe("incomplete");
  }
  let servedDigest = bootstrap.data.product.dashboard_digest;
  if (process.env.AQ_LIVE_CANDIDATE_MANIFEST) {
    const expected = await readFile(process.env.AQ_LIVE_CANDIDATE_MANIFEST);
    const expectedDigest = `sha256:${createHash("sha256").update(expected).digest("hex")}`;
    // AQ verifies its manifest on asset load and publishes that exact identity in bootstrap.
    // The manifest is deliberately not a public asset-router destination.
    expect(servedDigest, "bootstrap identifies the exact compiled candidate manifest").toBe(expectedDigest);
  }
  const measurements = [];
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    pages.push(page);
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => {
      const path = new URL(request.url()).pathname;
      if (!["GET", "HEAD"].includes(request.method())) mutations.push({ method: request.method(), path });
      if (path === `/api/observations/sessions/${binding.attempt_id}/usage`) usageReads.push({ width: viewport.width, path });
    });
    const prefix = viewport.width === 390 ? "phone" : "desktop";
    await page.goto(new URL(`/agents/${encodeURIComponent(sessionId)}?scope=project:${binding.project_id}`, origin).href);
    const detailsButton = page.getByRole("button", { name: "Session details", exact: true });
    await expect(detailsButton).toHaveAttribute("aria-expanded", "false");
    expect(usageReads.filter(read => read.width === viewport.width).length, "opening a session does not read usage").toBe(0);
    await capture(page, `${prefix}-focused-output.png`, viewport.width === 1440);
    await detailsButton.click();
    const section = page.getByRole("region", { name: "Session usage", exact: true });
    await expect(section.getByRole("button", { name: "Refresh session usage", exact: true })).toBeVisible();
    await expect(section.getByText("Unknown · not reported", { exact: true })).toBeVisible();
    if (usage.revision === 0) {
      expect(usage.last_recorded_at_ms).toBe(null);
      await expect(section.getByText("No accounting projection has been recorded for this session.", { exact: true })).toBeVisible();
      await expect(section.getByText(/Reported subtotal/)).toHaveCount(0);
    } else {
      for (const [index, category] of ["input", "output", "cache_read", "cache_write", "reasoning"].entries()) {
        const label = { input: "Input", output: "Output", cache_read: "Cache read", cache_write: "Cache write", reasoning: "Reasoning" }[category];
        const card = section.getByText(label, { exact: true }).locator("..");
        const counter = usage.usage.counters[category];
        if (expectedSubtotals) expect(counter).toEqual({ kind: "unknown", reason: "incomplete" });
        if (counter.kind === "unknown") {
          await expect(card.getByText(`Unknown · ${counter.reason.replaceAll("_", " ")}`, { exact: true })).toBeVisible();
          await expect(card.getByText(`Reported subtotal: ${usage.known_category_subtotals[index].toLocaleString("en-US")} · partial`, { exact: true })).toBeVisible();
        } else await expect(card.getByText(counter.value.toLocaleString("en-US"), { exact: true })).toBeVisible();
      }
      await expect(section.getByText(/Incomplete accounting/)).toBeVisible();
    }
    await expect(section.getByText(/total tokens|total cost|remaining quota/i)).toHaveCount(0);
    expect(usageReads.filter(read => read.width === viewport.width).length).toBe(1);
    await section.scrollIntoViewIfNeeded();
    // A scrolled full-page stitch relocates sticky shell chrome inside the image.
    // Capture the actual viewport at the selected usage section instead.
    await capture(page, `${prefix}-usage-details.png`);
    if (viewport.width === 390 && usage.revision > 0) {
      await section.getByRole("heading", { name: "Session usage", exact: true }).scrollIntoViewIfNeeded();
      await capture(page, "phone-usage-categories.png");
      await section.getByRole("button", { name: "Refresh session usage", exact: true }).scrollIntoViewIfNeeded();
      await capture(page, "phone-usage-cost.png");
    }
    const bounds = await section.boundingBox(); measurements.push({ viewport, usage: bounds });
    expect(bounds.width).toBeLessThanOrEqual(viewport.width);
    await section.getByRole("button", { name: "Refresh session usage", exact: true }).click();
    await expect(section.getByRole("button", { name: "Refresh session usage", exact: true })).toBeEnabled();
    await expect.poll(() => usageReads.filter(read => read.width === viewport.width).length).toBe(2);
    await detailsButton.click();
    await expect(section).toHaveCount(0);
    await detailsButton.click();
    await expect(section.getByRole("button", { name: "Refresh session usage", exact: true })).toBeVisible();
    await expect.poll(() => usageReads.filter(read => read.width === viewport.width).length).toBe(3);
    await detailsButton.click();
    await page.getByRole("link", { name: "All sessions", exact: true }).click();
    await expect(page.getByRole("list", { name: "Sessions", exact: true })).toBeVisible();
    await page.close();
  }
  expect(errors).toEqual([]); expect(mutations).toEqual([]);
  const result = { passed: true, origin: origin.origin, session_id: sessionId, attempt_id: binding.attempt_id, binding,
    usage_revision: usage.revision, canonical_calls: usage.canonical_calls, known_category_subtotals: usage.known_category_subtotals, cost: "unknown/not_reported", actual_projection: usage.revision === 0 ? "no accounting projection" : expectedSubtotals ? "synthetic persisted incomplete accounting fixture" : "retained projection",
    references: ["08-agents-focus-desktop.png", "11-agent-mobile-v2.png"], visual_subset: "on-demand session usage within preserved focused output workspace",
    served_bundle_digest: servedDigest, api_product_bundle_digest: bootstrap.data.product.dashboard_digest, measurements, usage_browser_reads: usageReads.length,
    mutations: mutations.length, page_errors: errors.length, captures, elapsed_ms: Math.round(performance.now() - started),
    note: "Actual AQ owner reads only; no interception, domain mutations, provider calls or quota/health inference. Optional nonempty fixture is persisted synthetic accounting evidence, never live provider usage or an invoice." };
  await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2) + "\n"); console.log(JSON.stringify(result));
} catch (error) {
  for (const [index, page] of pages.entries()) if (!page.isClosed()) await page.screenshot({ path: join(output, `failure-${index}.png`) }).catch(() => {});
  await writeFile(join(output, "result.json"), JSON.stringify({ passed: false, error: String(error), errors, mutations, usageReads }, null, 2) + "\n"); throw error;
} finally { await api.dispose(); await browser.close(); }
