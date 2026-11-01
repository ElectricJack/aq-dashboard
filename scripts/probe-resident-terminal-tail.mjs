#!/usr/bin/env node
// Actual server + worker output only. No request interception or fixture injection.
import { chromium, expect } from "@playwright/test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const origin = new URL(process.env.AQ_LIVE_URL ?? "");
if (!["http:", "https:"].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
  throw new Error("AQ_LIVE_URL must be the explicit human-listener origin");
}
const session = process.env.AQ_LIVE_SESSION_ID;
if (!session || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(session)) throw new Error("AQ_LIVE_SESSION_ID must be the actual session UUID");
const output = process.env.AQ_LIVE_OUTPUT_DIR ?? await mkdtemp(join(tmpdir(), "aq-resident-tail-browser-"));
await mkdir(output, { recursive: true });
const url = new URL(`/agents/${encodeURIComponent(session)}`, origin).href;
const started = performance.now();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
page.setDefaultTimeout(6000);
const errors = [], mutations = [], reads = [];
page.on("pageerror", e => errors.push(e.message));
page.on("request", r => {
  if (!["GET", "HEAD"].includes(r.method())) mutations.push({ method: r.method(), pathname: new URL(r.url()).pathname, body: r.postDataJSON() });
});
page.on("response", async response => {
  if (response.request().method() !== "GET" || !new URL(response.url()).pathname.endsWith("/tail")) return;
  if (response.status() !== 200) { reads.push({ status: response.status() }); return; }
  try {
    const body = await response.json();
    reads.push({ status: 200, terminal_id: body.terminal?.terminal_id, availability: body.availability,
      initial_incomplete: body.initial_incomplete, disconnected: body.disconnected,
      next_sequence: body.next_sequence, frame_count: body.frames?.length,
      expected_text: body.frames?.some(f => new TextDecoder().decode(new Uint8Array(f.bytes)).includes("synthetic native fixture output tick")) === true });
  } catch { reads.push({ status: 200, invalid_json: true }); }
});
try {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 6000 });
  const tail = page.getByRole("region", { name: "Read-only output tail" });
  await tail.getByRole("button", { name: "Watch output for up to 15 seconds" }).click();
  await expect(tail.getByLabel("Literal worker output")).toContainText("synthetic native fixture output tick");
  await expect(tail.getByText("Incomplete literal output only. Earlier bytes may be missing. This is not a terminal screen or snapshot.")).toBeVisible();
  await expect(tail.getByRole("status")).toHaveText("Disconnected — showing incomplete resident output");
  await expect(tail.getByRole("button", { name: "Stop watching" })).toBeVisible();
  expect(reads.some(r => r.status === 200 && r.availability === "resident_tail" && r.initial_incomplete === true && r.disconnected === true && r.expected_text)).toBe(true);
  expect(mutations).toHaveLength(1);
  expect(mutations[0].method).toBe("POST");
  expect(mutations[0].pathname).toMatch(/^\/api\/v1\/terminals\/[0-9a-f-]+\/mutations$/i);
  expect(mutations[0].body.kind).toBe("watch");
  expect(errors).toEqual([]);
  await tail.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, "resident-tail-desktop.png"), fullPage: true });
  const result = { passed: true, url, elapsed_ms: Math.round(performance.now() - started), screenshot: join(output, "resident-tail-desktop.png"), reads,
    watch_mutations: mutations.length, note: "Actual same-runtime resident bytes; incomplete literal tail, disconnected after physical stop. No terminal screen or provider claim." };
  await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
} catch (e) {
  await page.screenshot({ path: join(output, "failure.png"), fullPage: true }).catch(() => undefined);
  await writeFile(join(output, "result.json"), JSON.stringify({ passed: false, url, elapsed_ms: Math.round(performance.now() - started), error: String(e), reads, page_errors: errors }, null, 2) + "\n");
  throw e;
} finally {
  await browser.close();
}
