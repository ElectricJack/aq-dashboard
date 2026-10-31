import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Widths from docs/plans/0001 D-A11: 320/390 phone, 768 tablet, 1440 desktop.
const VIEWPORTS = [
  { name: "phone-320", width: 320, height: 640, phone: true },
  { name: "phone-390", width: 390, height: 844, phone: true },
  { name: "tablet-768", width: 768, height: 1024, phone: false },
  { name: "desktop-1440", width: 1440, height: 900, phone: false },
];

async function hasPageHorizontalScroll(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
}

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("shell renders without page-level horizontal scroll", async ({ page }) => {
      await page.goto("/overview");
      await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
      await expect(page.getByText("42% used")).toBeVisible();
      expect(await hasPageHorizontalScroll(page)).toBe(false);
    });

    test("the right navigation is reachable", async ({ page }) => {
      await page.goto("/overview");
      const primary = page.getByRole("navigation", { name: "Primary", exact: true });
      const compact = page.getByRole("navigation", { name: "Primary (compact)" });
      if (vp.phone) {
        await expect(compact).toBeVisible();
        await expect(primary).toBeHidden();
        await compact.getByRole("button", { name: "More" }).click();
        await compact.getByRole("link", { name: "Knowledge" }).click();
      } else {
        await expect(primary).toBeVisible();
        await expect(compact).toBeHidden();
        await primary.getByRole("link", { name: "Knowledge" }).click();
      }
      await expect(page.getByRole("heading", { level: 1, name: "Knowledge" })).toBeFocused();
      expect(await hasPageHorizontalScroll(page)).toBe(false);
    });

    test("has no automatically detectable WCAG A/AA violations", async ({ page }) => {
      await page.goto("/overview");
      await expect(page.getByText("42% used")).toBeVisible();
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    });
  });
}

test("unknown-usage scenario never renders a percentage", async ({ page }) => {
  await page.goto("/overview?scenario=unknown");
  const strip = page.getByRole("region", { name: /provider usage/i });
  await expect(strip.getByText("Usage unavailable").first()).toBeVisible();
  await expect(strip).not.toContainText("%");
});

test("mock mode is labelled on screen", async ({ page }) => {
  await page.goto("/overview");
  await expect(page.getByRole("banner").getByText(/mock data/i)).toBeVisible();
});

test("phone header scrolls away so it cannot obscure focused content", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/overview");
  await expect(page.getByText("42% used")).toBeVisible();
  const position = await page.getByRole("banner").evaluate((el) => getComputedStyle(el).position);
  expect(["static", "relative"]).toContain(position);
});
