import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// AG-A: the focused session fits the viewport; mock mode serves labelled terminal fixtures.
async function openWorker07(page: Page) {
  await page.goto("/agents/sess-07");
  await expect(page.getByRole("heading", { level: 2, name: "Worker 07" })).toBeAttached();
  await expect(page.getByRole("status").filter({ hasText: "Watch only" })).toBeVisible();
  await expect(page.locator(".xterm-rows")).toContainText("Fixture output for Worker 07");
}

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

test("desktop 1440x900: one breadcrumb row and a footer inside the viewport without page scroll", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWorker07(page);
  const detail = page.getByRole("region", { name: "Worker 07" });
  await expect(detail.getByRole("link", { name: "Back to Agents" })).toBeVisible();
  await expect(detail.getByRole("link", { name: "Fixture: Replay reconciliation" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Session switcher" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Agents" })).not.toBeInViewport({ ratio: 0.5 });
  const fit = await page.evaluate(() => ({ scroll: document.documentElement.scrollHeight, inner: innerHeight }));
  expect(fit.scroll).toBeLessThanOrEqual(fit.inner + 1);
  const footer = await detail.locator("footer").boundingBox();
  expect(footer).not.toBeNull();
  expect(footer!.y).toBeGreaterThanOrEqual(0);
  expect(footer!.y + footer!.height).toBeLessThanOrEqual(900);
  await axe(page);
});

test("phone 390x844: Back, name and expand in one row; terminal holds at least half the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openWorker07(page);
  const back = page.getByRole("link", { name: "Back to Agents" });
  await expect(back).toBeVisible();
  const backBox = (await back.boundingBox())!;
  expect(backBox.height).toBeGreaterThanOrEqual(44);
  const heading = (await page.getByRole("heading", { level: 2, name: "Worker 07" }).boundingBox())!;
  const expand = (await page.getByRole("button", { name: "Expand workspace" }).boundingBox())!;
  for (const box of [heading, expand]) expect(Math.abs(box.y + box.height / 2 - (backBox.y + backBox.height / 2))).toBeLessThanOrEqual(4);
  // Tabs collapse behind the name's dropdown on phone.
  const sessions = page.getByRole("button", { name: "Sessions" });
  await expect(sessions).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("navigation", { name: "Session switcher" })).toBeHidden();
  // The provider heading stays on one line.
  const provider = page.locator("[data-interactive-terminal]").locator("xpath=preceding-sibling::*[1]").locator("strong");
  expect((await provider.boundingBox())!.height).toBeLessThan(24);
  const screen = (await page.locator(".xterm-screen").boundingBox())!;
  expect(screen.height).toBeGreaterThanOrEqual(0.5 * 844);
  await axe(page);
  await sessions.click();
  await expect(page.getByRole("navigation", { name: "Session switcher" })).toBeVisible();
});
