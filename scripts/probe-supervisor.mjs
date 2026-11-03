#!/usr/bin/env node
// Explicit one-message probe. Fixture proof and live-owner proof are recorded separately.
import { chromium, expect, request } from "@playwright/test";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
const origin = new URL(process.env.AQ_LIVE_URL ?? "http://127.0.0.1:4196");
const output = process.env.AQ_LIVE_OUTPUT_DIR ?? "/tmp/aq-supervisor-browser";
const fixture = process.env.AQ_SUPERVISOR_FIXTURE === "1";
if (process.env.AQ_LIVE_ALLOW_SUPERVISOR_ENQUEUE !== "1") throw new Error("Set AQ_LIVE_ALLOW_SUPERVISOR_ENQUEUE=1 for this explicit single-send probe.");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true }), api = await request.newContext();
const errors = [], writes = [], captures = [], measurements = [];
const get = async path => { const response = await api.get(new URL(path, origin).href); expect(response.status(), path).toBe(200); return response.json(); };
const capture = async (page, name) => {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), "no horizontal page overflow").toBe(true);
  const path = join(output, name); await page.screenshot({ path }); captures.push(path);
};
const result = { passed: false, provenance: fixture ? "labelled local test double; not live supervisor qualification" : "live owner and supervisor", origin: origin.origin };
try {
  const bootstrap = await get("/api/v1/bootstrap");
  expect(bootstrap.data.global_supervisor.status).toBe("available");
  for (const name of ["supervisor.history.read", "supervisor.conversation", "supervisor.message.enqueue", "dashboard.actions"]) expect(bootstrap.data.capabilities.some(cap => cap.name === name && cap.enabled && cap.version === "1"), name).toBe(true);
  const discovery = await get("/api/human/conversations/global"), base = `/api/human/conversations/${discovery.conversation.id}`;
  const initial = await get(`${base}/messages?limit=16`);
  expect(initial.items.length).toBeLessThanOrEqual(16);
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  desktop.on("pageerror", error => errors.push(error.message));
  desktop.on("request", req => { if (!["GET", "HEAD"].includes(req.method())) writes.push({ method: req.method(), path: new URL(req.url()).pathname, body: req.postData() }); });
  await desktop.goto(new URL("/overview", origin).href);
  await desktop.getByRole("button", { name: "Open supervisor", exact: true }).click();
  await expect(desktop.getByRole("heading", { name: "Global supervisor", exact: true })).toBeVisible();
  const input = desktop.getByRole("textbox", { name: "Message the global supervisor", exact: true });
  const body = process.env.AQ_SUPERVISOR_PROBE_BODY ?? `${fixture ? "[Fixture] " : ""}G8 connectivity probe: please reply briefly in this conversation. Do not create work.`;
  await input.fill(body); await desktop.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].path).toBe("/api/v1/actions");
  const sent = JSON.parse(writes[0].body); expect(sent.kind).toBe("supervisor.message.send");
  expect(sent.payload.body).toBe(body); expect(sent.payload.context).toEqual([]); expect(sent.payload.attachments).toEqual([]);
  expect(sent.operation_id).not.toBe(sent.payload.message_id);
  let operation;
  await expect.poll(async () => { operation = await get(`/api/v1/operations/${sent.operation_id}`); return operation.data.disposition; }, { timeout: 25000, intervals: [250, 500, 1000] }).toBe("confirmed");
  const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
  expect(operation.data.request_digest).toBe(`sha256:${createHash("sha256").update(canonical({ request: sent, scope: operation.data.scope })).digest("hex")}`);
  let owner, reply;
  await expect.poll(async () => {
    const history = await get(`${base}/messages?limit=16`);
    owner = history.items.find(item => item.message_id === sent.payload.message_id);
    reply = owner && history.items.find(item => item.author.kind === "supervisor" && item.cursor.split(".")[0] === owner.cursor && item.dispatch?.dispatch_id && item.dispatch?.host_operation_id);
    return !!reply;
  }, { timeout: 25000, intervals: [250, 500, 1000] }).toBe(true);
  await expect(desktop.locator(`[data-message-id="${reply.message_id}"]`).getByText(reply.body, { exact: true })).toBeInViewport({ ratio: 1, timeout: 10000 });
  await capture(desktop, "desktop-admitted.png");
  await desktop.getByRole("button", { name: "Compose another message", exact: true }).click();
  await input.fill(fixture ? "[Fixture] Retained follow-up draft" : "Retained follow-up draft");
  await capture(desktop, "desktop-dock.png");
  await desktop.getByRole("button", { name: "Expand conversation", exact: true }).click();
  await expect(desktop).toHaveURL(/\/supervisor/);
  await expect(input).toHaveValue(fixture ? "[Fixture] Retained follow-up draft" : "Retained follow-up draft");
  await capture(desktop, "desktop-full.png");
  await desktop.getByRole("button", { name: "Dock chat", exact: true }).click();
  await expect(desktop).toHaveURL(/\/overview/); expect(writes).toHaveLength(1);
  for (const viewport of [{ width: 390, height: 844, name: "phone" }, { width: 320, height: 740, name: "compact" }, { width: 390, height: 530, name: "keyboard" }, { width: 900, height: 1000, name: "tablet" }]) {
    const page = await browser.newPage({ viewport });
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", req => { if (!["GET", "HEAD"].includes(req.method())) writes.push({ method: req.method(), path: new URL(req.url()).pathname, body: req.postData() }); });
    await page.goto(new URL("/supervisor", origin).href);
    await expect(page.getByRole("heading", { name: "Global supervisor", exact: true })).toBeVisible();
    await expect(page.locator(`[data-message-id="${reply.message_id}"]`).getByText(reply.body, { exact: true })).toBeInViewport({ ratio: viewport.height < 650 ? 0.5 : 1 });
    const editor = page.getByRole("textbox", { name: "Message the global supervisor", exact: true });
    await editor.fill(fixture ? "[Fixture] Unsent phone draft" : "Unsent phone draft");
    await editor.focus(); await editor.press("Shift+Enter");
    await editor.dispatchEvent("compositionstart"); await editor.press("Enter"); await editor.dispatchEvent("compositionend");
    await editor.fill(fixture ? "[Fixture] Unsent phone draft" : "Unsent phone draft");
    await expect(page.locator(`[data-message-id="${reply.message_id}"]`).getByText(reply.body, { exact: true })).toBeInViewport({ ratio: viewport.height < 650 ? 0.5 : 1 });
    const send = await page.getByRole("button", { name: "Send message", exact: true }).boundingBox();
    const compactNav = page.getByRole("navigation", { name: "Primary (compact)", exact: true });
    const nav = await compactNav.isVisible() ? await compactNav.boundingBox() : null;
    expect(send.y).toBeGreaterThanOrEqual(0); expect(send.y + send.height).toBeLessThanOrEqual(nav?.y ?? viewport.height);
    measurements.push({ viewport, send, navigation: nav, required_reply_visibility_ratio: viewport.height < 650 ? 0.5 : 1 });
    await capture(page, `${viewport.name}.png`);
    await page.getByRole("button", { name: "Back", exact: true }).click(); await expect(page).toHaveURL(/\/overview/);
    await page.close();
  }
  if (fixture) {
    for (const state of ["empty", "unavailable"]) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      page.on("pageerror", error => errors.push(error.message));
      if (state === "empty") await page.route("**/api/human/conversations/*/messages?*", route => route.fulfill({ json: { contract: discovery.contract, conversation: discovery.conversation, runtime: discovery.runtime, direction: "backward", through_cursor: "0", items: [], has_more: false, next_cursor: null } }));
      else await page.route("**/api/v1/bootstrap", route => route.fulfill({ json: { ...bootstrap, data: { ...bootstrap.data, global_supervisor: { status: "unavailable", conversation_id: discovery.conversation.id }, capabilities: bootstrap.data.capabilities.map(cap => cap.name === "supervisor.conversation" ? { ...cap, enabled: false } : cap) } } }));
      await page.goto(new URL("/supervisor", origin).href);
      if (state === "empty") await expect(page.getByText("No messages have been admitted to this global conversation.", { exact: true })).toBeVisible();
      else {
        await page.getByRole("textbox", { name: "Message the global supervisor", exact: true }).fill("[Fixture] Draft retained while unavailable");
        await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeDisabled();
        await expect(page.getByText(/Conversation unavailable; your draft is preserved/)).toBeVisible();
      }
      await capture(page, `phone-${state}.png`); await page.close();
    }
  }
  expect(writes).toHaveLength(1); expect(errors).toEqual([]);
  const manifestResponse = await api.get(new URL("/dashboard-manifest.json", origin).href);
  expect(manifestResponse.status()).toBe(200);
  const manifestBytes = await manifestResponse.body(), manifest = JSON.parse(manifestBytes);
  const bundle = `sha256:${createHash("sha256").update(manifestBytes).digest("hex")}`;
  expect(bootstrap.data.product.dashboard_digest).toBe(bundle);
  if (process.env.AQ_LIVE_CANDIDATE_MANIFEST) expect(await readFile(process.env.AQ_LIVE_CANDIDATE_MANIFEST)).toEqual(manifestBytes);
  for (const [path, expected] of Object.entries(manifest.files)) {
    const response = await api.get(new URL(path, origin).href); expect(response.status(), path).toBe(200);
    const bytes = await response.body(); expect(bytes.length, path).toBe(expected.bytes);
    expect(createHash("sha256").update(bytes).digest("hex"), path).toBe(expected.sha256);
  }
  await writeFile(join(output, "served-manifest.json"), manifestBytes);
  Object.assign(result, { passed: true, conversation_id: discovery.conversation.id, operation_id: sent.operation_id, message_id: owner.message_id, reply_id: reply.message_id, reply_cursor: reply.cursor, dispatch: reply.dispatch,
    initial_rows: initial.items.length, single_action_send: true, actual_live_reply: !fixture, references: ["04-supervisor-chat.png", "09-supervisor-full-desktop.png", "12-supervisor-mobile.png"], served_bundle_digest: bundle, served_assets_verified: Object.keys(manifest.files).length, captures, measurements, page_errors: errors });
} catch (error) { result.error = String(error); result.page_errors = errors; throw error; }
finally { await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2) + "\n"); console.log(JSON.stringify(result)); await api.dispose(); await browser.close(); }
