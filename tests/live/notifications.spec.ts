import { expect, test } from "@playwright/test";

// Current-account inspection only: actual human APIs, no interception or sends.
test("notification inbox and selected delivery match actual current-recipient records", async ({ page, request }) => {
  const bootstrap = (await (await request.get("/api/v1/bootstrap")).json()).data;
  const capability = bootstrap.capabilities.find((c: { name: string }) => c.name === "notifications.read");
  const mutations: string[] = [], errors: string[] = [];
  page.on("request", r => { if (!["GET", "HEAD"].includes(r.method())) mutations.push(r.method()); });
  page.on("pageerror", e => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/settings");
  const panel = page.getByRole("region", { name: "Your notifications" });
  await expect(panel).toBeVisible();
  if (!capability?.enabled) {
    await expect(panel.getByText(capability?.reason ?? "Not offered by this AQ server", { exact: true })).toBeVisible();
    test.info().annotations.push({ type: "notifications-capability", description: "Disabled; no live notification record claim" });
    return;
  }
  const reply = await request.get("/api/notifications?after=0&limit=16");
  expect(reply.status()).toBe(200);
  const actual = await reply.json();
  if (actual.items.length === 0) {
    await expect(panel.getByText("No notifications in this inbox.")).toBeVisible();
    test.info().annotations.push({ type: "notifications-records", description: "Actual inbox empty; positive record/detail coverage not established" });
    return;
  }
  const row = actual.items[0];
  expect(row.message.recipient_user_id).toBe(bootstrap.principal.id);
  const button = panel.locator(`button[data-message-id="${row.message.message_id}"]`);
  await expect(button).toBeVisible();
  await button.click();
  const detail = panel.getByRole("region", { name: "Notification delivery details" });
  const detailsReply = await request.get(`/api/notifications/${encodeURIComponent(row.message.message_id)}`);
  expect(detailsReply.status()).toBe(200);
  const inspected = await detailsReply.json();
  expect(inspected.message).toEqual(row.message);
  await expect(detail.getByText(inspected.message.summary, { exact: true })).toBeVisible();
  expect(await detail.locator("[data-status]").count()).toBe(inspected.deliveries.length);
  for (const d of inspected.deliveries) await expect(detail.locator(`[data-status="${d.status.kind}"]`)).toBeVisible();
  if (inspected.external_state === "no_external_route") await expect(detail.getByText("No external route was recorded for this message.")).toBeVisible();
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath("notifications-desktop.png"), fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.evaluate(el => el.scrollIntoView({ block: "start" }));
  await expect(detail.getByRole("button", { name: "Back to inbox" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  await page.screenshot({ path: test.info().outputPath("notifications-mobile.png"), fullPage: false });
  await detail.getByRole("button", { name: "Back to inbox" }).click();
  await expect(button).toBeFocused();
  expect(mutations).toEqual([]);
  expect(errors).toEqual([]);
  test.info().annotations.push({ type: "notifications-records", description: `${actual.items.length} actual inbox rows; selected message ${row.message.message_id}; ${inspected.deliveries.length} actual deliveries inspected; no external calls` });
});
