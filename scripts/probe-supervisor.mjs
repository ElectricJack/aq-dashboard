#!/usr/bin/env node
// Actual AQ mailbox only. One explicit enqueue is opt-in for a disposable owner fixture.
import { chromium, expect, request } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
const origin = new URL(process.env.AQ_LIVE_URL ?? "http://localhost:4196");
const output = process.env.AQ_LIVE_OUTPUT_DIR ?? "/tmp/aq-supervisor-browser";
const allowEnqueue = process.env.AQ_LIVE_ALLOW_SUPERVISOR_ENQUEUE === "1";
const hash = text => `sha256:${createHash("sha256").update(text).digest("hex")}`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true }), api = await request.newContext();
const started = performance.now(), errors = [], writes = [], captures = [], reads = [], pages = [];
async function get(path) { const response = await api.get(new URL(path, origin).href); expect(response.status(), path).toBe(200); return response.json(); }
async function capture(page, name) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), "no page horizontal overflow").toBe(false);
  const path = join(output, name); await page.screenshot({ path }); captures.push(path);
}
function track(page) {
  pages.push(page); page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (!["GET", "HEAD"].includes(request.method())) writes.push({ path, method: request.method(), body: request.postData() });
    if (path.startsWith("/api/human/conversations/")) reads.push({ path, query: new URL(request.url()).search });
  });
}
try {
  const bootstrap = await get("/api/v1/bootstrap");
  expect(bootstrap.data.capabilities.some(cap => cap.name === "supervisor.history.read" && cap.version === "1" && cap.enabled === true)).toBe(true);
  if (process.env.AQ_LIVE_CANDIDATE_MANIFEST) expect(bootstrap.data.product.dashboard_digest).toBe(hash(await readFile(process.env.AQ_LIVE_CANDIDATE_MANIFEST)));
  const discovery = await get("/api/human/conversations/global");
  expect(discovery.contract).toBe("human-supervisor-conversation-1");
  expect(discovery.runtime).toEqual({ state: "unavailable", binding: null, reason: "central_runtime_not_connected" });
  expect(discovery.limits).toEqual({ body_bytes: 16384, context_refs: 0, attachments: 0, history_page: 16 });
  if (process.env.AQ_LIVE_CONVERSATION_ID) expect(discovery.conversation.id).toBe(process.env.AQ_LIVE_CONVERSATION_ID);
  if (process.env.AQ_LIVE_ACTOR_ID) expect(bootstrap.data.principal.id).toBe(process.env.AQ_LIVE_ACTOR_ID);
  const base = `/api/human/conversations/${discovery.conversation.id}`;
  const initial = await get(`${base}/messages?limit=16`);
  expect(initial.conversation).toEqual(discovery.conversation);
  for (const item of initial.items) { expect(item.author.kind).toBe("human"); expect(item.thread_id).toBe(discovery.conversation.id); expect(item.body_digest).toBe(hash(item.body)); }
  if (allowEnqueue) expect(initial.items.length, "nonempty disposable owner fixture").toBeGreaterThanOrEqual(2);
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); track(desktop);
  await desktop.goto(new URL("/supervisor", origin).href);
  await expect(desktop.getByRole("heading", { name: "Global supervisor", exact: true })).toBeVisible();
  await expect(desktop.getByText(/Supervisor is not connected/)).toBeVisible();
  const input = desktop.getByRole("textbox", { name: "Message the global supervisor", exact: true });
  for (const item of initial.items) await expect(desktop.getByRole("list", { name: "Supervisor messages" }).getByText(item.body, { exact: true })).toBeVisible();
  await capture(desktop, "desktop-conversation-history.png");
  let admitted = null;
  if (allowEnqueue) {
    expect(bootstrap.data.capabilities.some(cap => cap.name === "supervisor.message.enqueue" && cap.version === "1" && cap.enabled === true)).toBe(true);
    const body = "UI16 disposable fixture: verify durable queued text only.";
    await input.fill(body); await desktop.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(desktop.getByText("Queued in the global mailbox. Delivery has not been attempted.", { exact: true })).toBeVisible();
    await expect(desktop.getByRole("list", { name: "Supervisor messages" }).getByText(body, { exact: true })).toBeVisible();
    expect(writes).toHaveLength(1); expect(writes[0].method).toBe("POST"); expect(writes[0].path).toBe(`${base}/messages`);
    const request = JSON.parse(writes[0].body);
    expect(request.body).toBe(body); expect(request.context).toEqual([]); expect(request.attachments).toEqual([]); expect(request.expected_conversation_revision).toBe(discovery.conversation.revision);
    expect(request.operation_id).not.toBe(request.message_id);
    const receipt = await get(`${base}/operations/${request.operation_id}`);
    expect(receipt.operation_id).toBe(request.operation_id); expect(receipt.message_id).toBe(request.message_id); expect(receipt.actor_id).toBe(bootstrap.data.principal.id);
    const canonical = JSON.stringify(Object.fromEntries(Object.entries(request).sort(([a], [b]) => a.localeCompare(b))));
    expect(receipt.request_digest).toBe(hash(canonical)); expect(receipt.body_digest).toBe(hash(body));
    expect(receipt.state).toBe("queued"); expect(receipt.host_delivery).toBe("not_attempted"); expect(receipt.agent_receipt).toBe(null);
    const history = await get(`${base}/messages?limit=16`), message = history.items.find(item => item.message_id === request.message_id);
    expect(message).toMatchObject({ cursor: receipt.cursor, conversation_id: discovery.conversation.id, thread_id: discovery.conversation.id, body, body_digest: receipt.body_digest, author: { kind: "human", user_id: bootstrap.data.principal.id } });
    await capture(desktop, "desktop-queued-message.png");
    await desktop.reload(); await expect(desktop.getByText("Queued in the global mailbox. Delivery has not been attempted.", { exact: true })).toBeVisible(); expect(writes).toHaveLength(1);
    await desktop.getByRole("button", { name: "Compose another message", exact: true }).click();
    admitted = { operation_id: request.operation_id, message_id: request.message_id, cursor: receipt.cursor, state: receipt.state, delivery: receipt.host_delivery };
  }
  await input.fill("Preserve this unsent global draft across project scope.");
  const scope = desktop.getByRole("combobox", { name: "Scope", exact: true });
  const projectOption = await scope.locator("option").evaluateAll(options => options.find(option => option.value.startsWith("project:"))?.value ?? null);
  let scopeSwitch = false;
  if (projectOption) {
    await scope.selectOption(projectOption); await expect(input).toHaveValue("Preserve this unsent global draft across project scope.");
    await scope.selectOption("all"); await expect(input).toHaveValue("Preserve this unsent global draft across project scope."); scopeSwitch = true;
  }
  expect(desktop.url()).not.toContain("Preserve");
  const phoneMeasurements = [];
  for (const viewport of [{ width: 390, height: 844, name: "phone" }, { width: 320, height: 740, name: "compact" }, { width: 390, height: 530, name: "reduced" }]) {
    const phone = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } }); track(phone);
    await phone.goto(new URL("/supervisor", origin).href);
    await expect(phone.getByRole("heading", { name: "Global supervisor", exact: true })).toBeVisible();
    await expect(phone.getByText(/Supervisor is not connected/)).toBeVisible();
    if (admitted) await expect(phone.getByRole("list", { name: "Supervisor messages" }).getByText("UI16 disposable fixture: verify durable queued text only.", { exact: true })).toBeVisible();
    const initialSend = await phone.getByRole("button", { name: "Send message", exact: true }).boundingBox();
    const initialNavigation = await phone.getByRole("navigation", { name: "Primary (compact)", exact: true }).boundingBox();
    if (viewport.name !== "reduced") expect(initialSend.y + initialSend.height, "Send visible before focusing at normal phone height").toBeLessThanOrEqual(initialNavigation.y);
    await capture(phone, `${viewport.name}-conversation-history.png`);
    const phoneInput = phone.getByRole("textbox", { name: "Message the global supervisor", exact: true });
    await phoneInput.fill("Unsent phone draft"); await phoneInput.focus();
    await phoneInput.press("Shift+Enter");
    await phoneInput.dispatchEvent("compositionstart"); await phoneInput.press("Enter"); await phoneInput.dispatchEvent("compositionend");
    expect(writes.length).toBe(allowEnqueue ? 1 : 0);
    const send = phone.getByRole("button", { name: "Send message", exact: true });
    await send.scrollIntoViewIfNeeded();
    const inputBounds = await phoneInput.boundingBox(), sendBounds = await send.boundingBox();
    const navigation = phone.getByRole("navigation", { name: "Primary (compact)", exact: true });
    const navBounds = await navigation.boundingBox();
    expect(inputBounds.y).toBeGreaterThanOrEqual(0);
    expect(inputBounds.y + inputBounds.height, "focused message field above phone navigation").toBeLessThanOrEqual(navBounds.y);
    expect(sendBounds.y + sendBounds.height, "Send above phone navigation").toBeLessThanOrEqual(navBounds.y);
    await capture(phone, `${viewport.name}-text-composer.png`);
    phoneMeasurements.push({ viewport, initial_send: initialSend, input: inputBounds, send: sendBounds, navigation_top: navBounds.y });
    await navigation.getByRole("link", { name: "Overview", exact: true }).click();
    await expect(phone.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
    await phone.goBack();
    await expect(phone.getByRole("heading", { name: "Global supervisor", exact: true })).toBeVisible();
    expect(writes.length).toBe(allowEnqueue ? 1 : 0);
  }
  expect(writes.length).toBe(allowEnqueue ? 1 : 0); expect(errors).toEqual([]);
  expect(reads.every(read => !new URLSearchParams(read.query).has("scope"))).toBe(true);
  const result = { passed: true, origin: origin.origin, conversation_id: discovery.conversation.id, actor_id: bootstrap.data.principal.id, initial_human_rows: initial.items.length, phone_measurements: phoneMeasurements, keyboard_scope: "reduced viewport focus, Shift+Enter and composition event guard; physical OS keyboard not qualified",
    admitted, scope_switch_performed: scopeSwitch, runtime: discovery.runtime, references: ["04-supervisor-chat.png", "09-supervisor-full-desktop.png", "12-supervisor-mobile.png"],
    visual_subset: "full-page global human-message history and pending-safe text composer; docking deferred", served_bundle_digest: bootstrap.data.product.dashboard_digest,
    explicit_enqueue_requests: writes.length, page_errors: errors.length, captures, elapsed_ms: Math.round(performance.now() - started),
    note: "Actual mailbox owner and SQL history; optional single enqueue uses the disposable synthetic owner fixture. Queued only, no delivery/runtime/provider/worker claim or fabricated replies. No interception or body storage." };
  await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2) + "\n"); console.log(JSON.stringify(result));
} catch (error) {
  for (const [index, page] of pages.entries()) if (!page.isClosed()) await page.screenshot({ path: join(output, `failure-${index}.png`) }).catch(() => {});
  await writeFile(join(output, "result.json"), JSON.stringify({ passed: false, error: String(error), errors, writes: writes.map(({ path, method }) => ({ path, method })), reads }, null, 2) + "\n"); throw error;
} finally { await api.dispose(); await browser.close(); }
