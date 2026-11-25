import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 900 } });

for (const width of [1440, 390, 320]) {
  test(`Performance reflows at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/performance");
    await expect(page.getByRole("heading", { name: "Performance", exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Lab worker")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("table", { name: "Usage by actual model" })).toBeVisible({ timeout: 20_000 });
    const contentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(contentWidth).toBe(width);

    if (width < 768) {
      await page.getByRole("button", { name: /More/ }).click();
      const nav = page.getByRole("list", { name: "More destinations" });
      await expect(nav.getByRole("link", { name: "Performance" })).toBeVisible({ timeout: 20_000 });
      await page.keyboard.press("Escape");
      await expect(nav).toHaveCount(0);
    }
    const violations = await new AxeBuilder({ page }).include("#content").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(violations.violations).toEqual([]);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: testInfo.outputPath("performance.png"), fullPage: true });
    if (width < 768) await page.screenshot({ path: testInfo.outputPath("viewport.png") });
  });
}
