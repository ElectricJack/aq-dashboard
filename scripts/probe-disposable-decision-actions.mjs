#!/usr/bin/env node
// Explicitly destructive only inside the disposable SQL review integration fixture.
// Faults occur in an actual loopback HTTP proxy after the protected owner commits.
import { createServer } from "node:http";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const origin = new URL(process.env.AQ_LIVE_URL ?? "");
if (process.env.AQ_TEST_DISPOSABLE_REVIEW_ACTIONS !== "1" || origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || origin.pathname !== "/" || origin.username || origin.password || !origin.port) throw new Error("Disposable review fixture acknowledgement and explicit ephemeral loopback origin required");
const selected = process.env.AQ_LIVE_DECISION_ID;
if (!selected || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(selected)) throw new Error("Fixture-generated exact review ID required");
const directory = process.env.AQ_LIVE_OUTPUT_DIR ?? await mkdtemp(join(tmpdir(), "aq-review-actions-"));
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ headless: true });
let proxy;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const get = async path => { const response = await context.request.get(new URL(path, origin).href); assert.equal(response.status(), 200); return response.json(); };
  const bootstrap = await get("/api/v1/bootstrap"), actor = bootstrap.data.principal.id;
  assert(bootstrap.data.capabilities.some(c => c.name === "decisions.resolve" && c.enabled && c.version === "1"));
  const list = await get("/api/reviews/decisions?state=open&limit=25");
  assert.equal(list.items.length, 3, "exact disposable fixture cardinality required");
  assert(list.items.some(i => i.decision_id === selected));
  const ids = [selected, ...list.items.map(i => i.decision_id).filter(id => id !== selected)];
  const before = new Map();
  for (const id of ids) { const detail = await get(`/api/reviews/decisions/${id}`); assert.equal(detail.state, "pending"); assert.equal(detail.decision_revision, 1); assert(detail.request.eligible_owners.includes(actor)); before.set(id, detail); }
  const page = await context.newPage(), requests = [], pageErrors = [];
  page.on("pageerror", e => pageErrors.push(e.message));
  page.on("request", r => { if (r.method() === "POST" && /\/resolve$/.test(new URL(r.url()).pathname)) requests.push({ path: new URL(r.url()).pathname, body: r.postDataJSON() }); });
  function validateReceipt(receipt, request, id, choice) {
    assert.equal(receipt.decision_id, id); assert.equal(receipt.decision_revision, 2);
    assert.deepEqual(receipt.subject, before.get(id).request.subject);
    assert.deepEqual(receipt.review_policy, before.get(id).request.review_policy);
    assert.equal(receipt.eligibility_project_revision, before.get(id).request.eligibility_project_revision);
    assert.equal(receipt.finality.kind, "human_answer"); assert.equal(receipt.finality.choice, choice);
    assert.equal(receipt.finality.owner_user_id, actor); assert.equal(receipt.finality.operation_id, request.operation_id);
  }
  async function open(id, base = origin) {
    await page.goto(new URL(`/decisions/${id}`, base).href, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "Approve revision 1" })).toBeVisible();
    await page.getByRole("textbox", { name: "Decision note" }).fill("Local disposable review browser fixture");
  }
  async function confirmRecorded(id, choice, receipt, request) {
    validateReceipt(receipt, request, id, choice);
    await expect(page.getByText(`Recorded decision: ${choice}`, { exact: true })).toBeVisible();
    await expect(page.getByText("A recorded answer does not establish task completion or source publication.", { exact: true })).toBeVisible();
    expect(await page.getByText("Task complete", { exact: true }).count()).toBe(0);
    expect(await page.getByText("Merged", { exact: true }).count()).toBe(0);
    const after = await get(`/api/reviews/decisions/${id}`);
    assert.deepEqual(after.subject, before.get(id).subject); assert.equal(after.state, "answered");
    assert.deepEqual(after.receipt, receipt); assert.equal(after.current_report_head, true);
  }
  for (const [index, choice, label] of [[0, "approve", "Approve revision 1"], [1, "reject", "Request changes"]]) {
    const id = ids[index]; await open(id);
    const responseJob = page.waitForResponse(r => new URL(r.url()).pathname === `/api/reviews/decisions/${id}/resolve` && r.request().method() === "POST");
    // Both clicks hit the actual UI. The owner must receive one logical answer.
    await page.getByRole("button", { name: label }).dblclick();
    const response = await responseJob; assert.equal(response.status(), 200);
    const sent = requests.filter(r => r.path.includes(id)); assert.equal(sent.length, 1);
    await confirmRecorded(id, choice, await response.json(), sent[0].body);
  }
  const lostId = ids[2], received = []; let dropped = false;
  proxy = createServer(async (request, response) => {
    try {
      if (!request.url?.startsWith("/") || request.url.startsWith("//")) { response.writeHead(400).end(); return; }
      const chunks = []; let size = 0;
      for await (const chunk of request) { size += chunk.length; if (size > 65536) throw new Error("bounded fixture request"); chunks.push(chunk); }
      const body = Buffer.concat(chunks), headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) if (value && !["host", "connection", "content-length", "origin", "referer"].includes(key)) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      // Explicit local test proxy preserves the source router's configured CSRF origin.
      if (request.method !== "GET" && request.method !== "HEAD") headers.set("origin", origin.origin);
      const upstream = await fetch(new URL(request.url, origin), { method: request.method, headers, ...(body.length ? { body } : {}), redirect: "error" });
      const bytes = Buffer.from(await upstream.arrayBuffer());
      if (request.method === "POST" && request.url === `/api/reviews/decisions/${lostId}/resolve`) {
        const sent = JSON.parse(body.toString()); assert.equal(upstream.status, 200);
        const receipt = JSON.parse(bytes.toString()); validateReceipt(receipt, sent, lostId, "approve"); received.push({ sent, receipt });
        if (!dropped) {
          dropped = true;
          // Return real status/headers and an incomplete prefix after commit.
          // A socket-only pre-header close can be transparently retried by a browser.
          response.writeHead(upstream.status, { "content-type": "application/json", "content-length": String(bytes.length), "connection": "close" });
          response.end(bytes.subarray(0, 8)); return;
        }
      }
      response.writeHead(upstream.status, Object.fromEntries([...upstream.headers].filter(([key]) => !["content-encoding", "content-length", "transfer-encoding", "connection"].includes(key)))); response.end(bytes);
    } catch (error) { response.destroy(error); }
  });
  await new Promise(resolve => proxy.listen(0, "127.0.0.1", resolve));
  const proxied = new URL(`http://127.0.0.1:${proxy.address().port}/`);
  await open(lostId, proxied);
  await page.getByRole("button", { name: "Approve revision 1" }).click();
  await expect(page.getByText(/Delivery is unknown/)).toBeVisible(); assert(dropped); assert.equal(received.length, 1);
  const responseJob = page.waitForResponse(r => new URL(r.url()).pathname === `/api/reviews/decisions/${lostId}/resolve` && r.request().method() === "POST");
  await page.getByRole("button", { name: "Retry same answer" }).click();
  const response = await responseJob; assert.equal(response.status(), 200); assert.equal(received.length, 2);
  assert.deepEqual(received[1].sent, received[0].sent); assert.deepEqual(received[1].receipt, received[0].receipt);
  await confirmRecorded(lostId, "approve", await response.json(), received[0].sent);
  const sentLost = requests.filter(r => r.path.includes(lostId)); assert.equal(sentLost.length, 2); assert.deepEqual(sentLost[1].body, sentLost[0].body);
  assert.equal(requests.length, 4); assert.deepEqual(pageErrors, []);
  await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: join(directory, "recorded-disposable-answer.png"), fullPage: true });
  const result = { passed: true, disposable_fixture: true, approve_doubleclick_posts: 1, reject_doubleclick_posts: 1, committed_response_dropped: true, explicit_retry_same_bytes: true, replay_exact_receipt: true, source_subject_pins_unchanged: true, observed_resolve_posts: 4, decision_ids: ids, browser_interception: false, task_completion_or_merge_claim: false, screenshot: join(directory, "recorded-disposable-answer.png") };
  await writeFile(join(directory, "actions.json"), JSON.stringify(result, null, 2) + "\n"); console.log(JSON.stringify(result));
} finally {
  await browser.close();
  if (proxy) { proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); }
}
