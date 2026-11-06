import { expect, test } from "@playwright/test";

// QA 2026-11-06 ISSUE-014: the notifications card spans the Settings grid at desktop width,
// and recorded times are readable (the exact ISO instant stays in the title).
test.use({ viewport: { width: 1440, height: 900 } });

test("notifications span the settings grid and times are readable", async ({ page }) => {
  await page.goto("/settings");
  const notifications = page.getByRole("region", { name: "Your notifications" });
  await expect(notifications).toBeVisible({ timeout: 15_000 });
  const identity = (await page.getByRole("region", { name: "Identity" }).boundingBox())!;
  const display = (await page.getByRole("region", { name: "Display" }).boundingBox())!;
  const card = (await notifications.boundingBox())!;
  expect(Math.abs(card.x - identity.x)).toBeLessThan(2);
  expect(Math.abs(card.x + card.width - (display.x + display.width))).toBeLessThan(2);
  const text = await page.locator("main").innerText();
  expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  for (const time of await page.locator("main time[title]").all()) expect(await time.getAttribute("title")).toBe(await time.getAttribute("datetime"));
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
});
