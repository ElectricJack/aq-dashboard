#!/usr/bin/env node
// Actual assembled daemon/bundle only. No interception or domain writes.
import { chromium, expect } from "@playwright/test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const origin = new URL(process.env.AQ_LIVE_URL ?? "");
if (!["http:", "https:"].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("Explicit AQ_LIVE_URL origin required");
const id = process.env.AQ_LIVE_RESULT_ID;
const revision = process.env.AQ_LIVE_RESULT_REVISION;
if (!id || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id) || !revision || !/^[0-9a-f]{64}$/.test(revision)) throw new Error("Explicit actual result UUID/revision required");
const output = process.env.AQ_LIVE_OUTPUT_DIR ?? await mkdtemp(join(tmpdir(), "aq-result-browser-"));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
page.setDefaultTimeout(6000);
const errors = [], mutations = [];
page.on("pageerror", e => errors.push(e.message));
page.on("request", r => { if (!["GET", "HEAD"].includes(r.method())) mutations.push(r.method() + " " + new URL(r.url()).pathname); });
const started = performance.now();
try {
  const detailPath = `/api/human/results/${id}/revisions/${revision}`;
  const response = await page.request.get(new URL(detailPath, origin).href);
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.schema_version).toBe(1);
  expect(body.coverage).toBe("recorded_legacy_native_only");
  expect(body.items).toHaveLength(1);
  const actual = body.items[0];
  expect(actual.report_id).toBe(id); expect(actual.revision).toBe(revision);
  expect(actual.conclusion).toEqual(expect.any(String));
  await page.goto(new URL("/results", origin).href, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1, name: "Results" })).toBeVisible();
  // The isolated qualification fixture contains this exact retained report.
  const card = page.getByRole("article", { name: `Recorded result ${id}` });
  await expect(card).toBeVisible();
  await expect(card).toContainText(actual.conclusion);
  await expect(card.getByRole("link", { name: actual.conclusion, exact: true })).toHaveAttribute("href", `/results/${id}/revisions/${revision}`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(output, "results-desktop.png"), fullPage: true });
  await card.getByRole("link", { name: actual.conclusion, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/results/${id}/revisions/${revision}$`));
  await expect(page.getByRole("article", { name: `Recorded result ${id}` })).toContainText(actual.source_base.hex);
  await expect(page.getByText("Worker-reported outcome:")).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: actual.conclusion, exact: true })).toBeVisible();
  await page.screenshot({ path: join(output, "result-detail-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(new URL(`/results/${id}/revisions/${revision}`, origin).href, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: actual.conclusion, exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await page.screenshot({ path: join(output, "result-detail-mobile.png"), fullPage: true });
  expect(errors).toEqual([]); expect(mutations).toEqual([]);
  const result = { passed: true, origin: origin.origin, report_id: id, revision, elapsed_ms: Math.round(performance.now() - started), screenshots: ["results-desktop.png", "result-detail-desktop.png", "result-detail-mobile.png"], coverage: body.coverage, note: "Actual retained owner metadata; this does not qualify a model, media, acceptance or settlement." };
  await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
} catch (error) {
  await page.screenshot({ path: join(output, "failure.png"), fullPage: true }).catch(() => {});
  await writeFile(join(output, "result.json"), JSON.stringify({ passed: false, report_id: id, error: String(error), page_errors: errors, mutations }, null, 2) + "\n");
  throw error;
} finally { await browser.close(); }
