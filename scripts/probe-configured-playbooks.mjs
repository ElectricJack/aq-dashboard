#!/usr/bin/env node
// Compiled bundle + actual configured protected owner only. No interception.
import { chromium, expect } from "@playwright/test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const origin = new URL(process.env.AQ_LIVE_URL ?? "");
if (!["http:", "https:"].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("Explicit human-listener origin required");
function required(name) { const value = process.env[name]; if (!value || value.length > 256 || /[\u0000-\u001f]/.test(value)) throw new Error(`Missing or invalid ${name}`); return value; }
const run = required("AQ_LIVE_RUN_ID"), child = required("AQ_LIVE_CHILD_RUN_ID");
const artifact = required("AQ_LIVE_PLAYBOOK_ARTIFACT"), childArtifact = required("AQ_LIVE_CHILD_ARTIFACT");
const output = process.env.AQ_LIVE_OUTPUT_DIR ?? await mkdtemp(join(tmpdir(), "aq-playbooks-browser-"));
await mkdir(output, { recursive: true });
const started = performance.now(); const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } }); page.setDefaultTimeout(6000);
const errors = [], mutations = []; let apiReads = 0;
page.on("pageerror", e => errors.push(e.message));
page.on("request", r => { if (!["GET", "HEAD"].includes(r.method())) mutations.push({ method: r.method(), path: new URL(r.url()).pathname }); if (new URL(r.url()).pathname.startsWith("/api/playbooks/inspection/")) apiReads++; });
async function actual(path) { const response = await page.request.get(new URL(path, origin).href); expect(response.status()).toBe(200); return response.json(); }
try {
  const bootstrap = await actual("/api/v1/bootstrap");
  expect(bootstrap.data.capabilities.find(c => c.name === "playbooks.inspect")?.enabled).toBe(true);
  const runs = await actual("/api/playbooks/inspection/runs?limit=25");
  expect(runs.api_version).toBe("playbooks-inspection-1");
  expect(runs.items.some(r => r.id === run && r.artifact === artifact)).toBe(true);
  expect(runs.items.some(r => r.id === child && r.artifact === childArtifact)).toBe(true);
  const detail = await actual(`/api/playbooks/inspection/runs/${encodeURIComponent(run)}?limit=25`);
  expect(detail.run.children).toContain(child); expect(detail.receipts.items.length).toBeGreaterThan(0);
  expect(detail.observation_is_atomic).toBe(false); expect(detail.run.status).toBe("completed");
  await page.goto(new URL("/playbooks", origin).href, { waitUntil: "domcontentloaded" });
  const roster = page.getByRole("list", { name: "Playbook runs" });
  await expect(roster.getByRole("link", { name: `Inspect ${run}`, exact: true })).toBeVisible();
  await roster.getByRole("link", { name: `Inspect ${run}`, exact: true }).click();
  const inspector = page.getByRole("region", { name: `Run ${run}`, exact: true });
  await expect(inspector).toBeVisible(); await expect(inspector.getByText(artifact, { exact: true })).toBeVisible();
  await expect(inspector.getByRole("list", { name: "Execution timeline" })).toContainText("child admitted");
  await expect(inspector.getByRole("link", { name: child, exact: true })).toBeVisible();
  await expect(page.getByText(/Mock data/)).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(output, "playbooks-desktop.png"), fullPage: true });
  await inspector.getByRole("link", { name: child, exact: true }).click();
  const childView = page.getByRole("region", { name: `Run ${child}`, exact: true });
  await expect(childView.getByText(childArtifact, { exact: true })).toBeVisible();
  await expect(childView.getByRole("link", { name: "Parent workflow", exact: true })).toBeVisible();
  await childView.getByRole("link", { name: "Parent workflow", exact: true }).click();
  await expect(inspector).toBeVisible(); await page.reload(); await expect(inspector).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("link", { name: "All runs", exact: true })).toBeVisible();
  await expect(roster).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(output, "playbooks-mobile.png"), fullPage: true });
  await page.getByRole("link", { name: "All runs", exact: true }).click(); await expect(roster).toBeVisible();
  await page.getByRole("button", { name: "Admissions", exact: true }).click();
  await expect(page.getByRole("list", { name: "Playbook admissions" })).toContainText("engine accepted");
  expect(mutations).toEqual([]); expect(errors).toEqual([]); expect(apiReads).toBeGreaterThan(0);
  const result = { passed: true, elapsed_ms: Math.round(performance.now() - started), origin: origin.href,
    run, child, artifact, child_artifact: childArtifact, receipt_count: detail.receipts.items.length,
    namespace: runs.namespace.id, read_only_browser: true, api_reads: apiReads,
    screenshots: [join(output, "playbooks-desktop.png"), join(output, "playbooks-mobile.png")],
    note: "Actual protected engine and compiled bundle; labelled development parent/child admitted through typed owner APIs. No interception/provider; definitions and activation discovery remain deferred." };
  await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2) + "\n"); console.log(JSON.stringify(result));
} catch (error) {
  await page.screenshot({ path: join(output, "failure.png"), fullPage: true }).catch(() => undefined);
  await writeFile(join(output, "result.json"), JSON.stringify({ passed: false, error: String(error), page_errors: errors, mutations, api_reads: apiReads }, null, 2) + "\n"); throw error;
} finally { await browser.close(); }
