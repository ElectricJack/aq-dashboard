#!/usr/bin/env node
// Read-only positive qualification against an actual configured review owner.
import { chromium, expect } from "@playwright/test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const origin = new URL(process.env.AQ_LIVE_URL ?? "");
if (!["http:", "https:"].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("Explicit AQ_LIVE_URL origin required");
const directory = process.env.AQ_LIVE_OUTPUT_DIR ?? await mkdtemp(join(tmpdir(), "aq-decisions-browser-"));
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const bootstrap = await context.request.get(new URL("/api/v1/bootstrap", origin).href);
  if (!bootstrap.ok()) throw new Error("Actual authenticated bootstrap required");
  const body = await bootstrap.json();
  if (!body.data?.capabilities?.some(c => c.name === "decisions.read" && c.enabled && c.version === "1")) throw new Error("Configured decisions.read v1 required; this is not a skipped positive check");
  const list = await context.request.get(new URL("/api/reviews/decisions?state=open&limit=25", origin).href);
  if (!list.ok()) throw new Error("Actual review inbox required");
  const pageData = await list.json();
  const id = process.env.AQ_LIVE_DECISION_ID ?? pageData.items?.[0]?.decision_id;
  if (typeof id !== "string" || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id)) throw new Error("An actual persisted review is required for positive qualification");
  const detail = await context.request.get(new URL(`/api/reviews/decisions/${id}`, origin).href);
  if (!detail.ok()) throw new Error("Actual current-authorized review detail required");
  const record = await detail.json();
  const criterion = record.acceptance_criteria?.[0]?.text ?? record.subject?.criteria?.[0];
  if (typeof criterion !== "string" || !criterion.length) throw new Error("Actual retained criteria required");
  const page = await context.newPage(), errors = [], mutations = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("request", r => { if (!["GET", "HEAD"].includes(r.method())) mutations.push(r.method()); });
  await page.goto(new URL(`/decisions/${id}`, origin).href, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Decisions", exact: true })).toBeVisible();
  await expect(page.getByText(criterion, { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Decision context", exact: true })).toBeVisible();
  await expect(page.getByText(record.subject.source.resulting_object.hex, { exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(directory, "decisions-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText(criterion, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(directory, "decisions-mobile.png"), fullPage: true });
  expect(errors).toEqual([]); expect(mutations).toEqual([]);
  const result = { passed: true, origin: origin.href, decision_id: id, actual_inbox_items: pageData.items.length, exact_criterion: true, source_object: true, desktop_and_mobile: true, mutations: 0, screenshots: directory };
  await writeFile(join(directory, "result.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
