#!/usr/bin/env node
// Positive-only persisted notification inspection. Never sends or retries.
import { chromium, expect } from "@playwright/test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const origin = new URL(process.env.AQ_LIVE_URL ?? "");
if (!["http:", "https:"].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("AQ_LIVE_URL must be the explicit human-listener origin");
const notificationId = process.env.AQ_LIVE_NOTIFICATION_ID;
if (!notificationId || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(notificationId)) throw new Error("AQ_LIVE_NOTIFICATION_ID must be the persisted message UUID");
const output = process.env.AQ_LIVE_OUTPUT_DIR ?? await mkdtemp(join(tmpdir(), "aq-notification-browser-"));
await mkdir(output, { recursive: true, mode: 0o700 });
const started = performance.now();
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, baseURL: origin.href });
const page = await context.newPage(); page.setDefaultTimeout(6000);
const errors = [], mutations = [], foreignRequests = [];
page.on("pageerror", e => errors.push(e.message));
page.on("request", request => {
  const url = new URL(request.url());
  if (!["GET", "HEAD"].includes(request.method())) mutations.push({ method: request.method(), path: url.pathname });
  if (url.origin !== origin.origin) foreignRequests.push(url.origin);
});
async function read(path) {
  const response = await context.request.get(path, { timeout: 5000, maxRedirects: 0 });
  expect(response.status(), `actual API ${path}`).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/json");
  return response.json();
}
try {
  const boot = await read("/api/v1/bootstrap");
  expect(boot.api_version).toBe("dashboard-read-1");
  expect(boot.data.product.dashboard_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  if (process.env.AQ_LIVE_DASHBOARD_SHA256) expect(boot.data.product.dashboard_digest).toBe(`sha256:${process.env.AQ_LIVE_DASHBOARD_SHA256}`);
  expect(boot.data.capabilities.some(c => c.name === "notifications.read" && c.version === "1" && c.enabled === true)).toBe(true);
  let after = 0, row, targetPage = 0;
  for (let n = 0; n < 4; n++) {
    const inbox = await read(`/api/notifications?after=${after}&limit=16`);
    expect(inbox.items.length).toBeLessThanOrEqual(16);
    for (const item of inbox.items) expect(item.message.recipient_user_id).toBe(boot.data.principal.id);
    row = inbox.items.find(item => item.message.message_id === notificationId); targetPage = n;
    if (row || inbox.next_after === null) break;
    expect(Number.isSafeInteger(inbox.next_after) && inbox.next_after > after).toBe(true); after = inbox.next_after;
  }
  expect(row, "exact persisted fixture must be discoverable; empty inbox is not a positive result").toBeTruthy();
  expect(row.external_state).toBe("no_external_route");
  const inspected = await read(`/api/notifications/${encodeURIComponent(notificationId)}`);
  expect(inspected.message).toEqual(row.message);
  expect(inspected.message.recipient_user_id).toBe(boot.data.principal.id);
  expect(inspected.external_state).toBe("no_external_route"); expect(inspected.deliveries).toEqual([]);

  await page.goto("/settings", { waitUntil: "domcontentloaded", timeout: 6000 });
  const panel = page.getByRole("region", { name: "Your notifications" });
  const message = panel.locator(`button[data-message-id="${notificationId}"]`);
  await expect(panel.getByRole("list", { name: "Notification inbox" }).getByRole("button").first()).toBeVisible();
  for (let n = 0; n < targetPage; n++) {
    const reply = page.waitForResponse(r => new URL(r.url()).pathname === "/api/notifications" && r.request().method() === "GET");
    await panel.getByRole("button", { name: "Load more notifications" }).click();
    expect((await reply).status()).toBe(200);
  }
  await expect(message).toBeVisible(); await message.click();
  const detail = panel.getByRole("region", { name: "Notification delivery details" });
  await expect(detail.getByText(inspected.message.summary, { exact: true })).toBeVisible();
  await expect(detail.getByText("No external route was recorded for this message.")).toBeVisible();
  await expect(detail.locator("[data-delivery-id]")).toHaveCount(0);
  await detail.getByText("Message identifiers and expiry", { exact: true }).click();
  await expect(detail.getByText(notificationId, { exact: true })).toBeVisible();
  await detail.getByText("Message identifiers and expiry", { exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, "notifications-desktop.png"), fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.evaluate(el => el.scrollIntoView({ block: "start" }));
  await expect(detail.getByRole("button", { name: "Back to inbox" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  await page.screenshot({ path: join(output, "notifications-mobile.png"), fullPage: false });
  await detail.getByRole("button", { name: "Back to inbox" }).click();
  await expect(message).toBeFocused();
  expect(mutations).toEqual([]); expect(foreignRequests).toEqual([]); expect(errors).toEqual([]);
  const result = { passed: true, origin: origin.origin, dashboard_digest: boot.data.product.dashboard_digest, notification_id: notificationId, recipient_id: boot.data.principal.id,
    external_state: inspected.external_state, delivery_count: inspected.deliveries.length, mutations: mutations.length, external_requests: foreignRequests.length,
    elapsed_ms: Math.round(performance.now() - started), screenshots: [join(output, "notifications-desktop.png"), join(output, "notifications-mobile.png")],
    note: "Actual current-recipient persisted no-external-route notification; read-only UI inspection. No sends, retries, transport acceptance or human-acknowledgment claim." };
  await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2) + "\n"); console.log(JSON.stringify(result));
} catch (e) {
  await page.screenshot({ path: join(output, "failure.png"), fullPage: false }).catch(() => undefined);
  await writeFile(join(output, "result.json"), JSON.stringify({ passed: false, origin: origin.origin, notification_id: notificationId, elapsed_ms: Math.round(performance.now() - started), error: String(e), page_errors: errors }, null, 2) + "\n");
  throw e;
} finally { await browser.close(); }
