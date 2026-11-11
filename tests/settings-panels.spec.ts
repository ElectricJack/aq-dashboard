import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const width of [1440, 390, 320]) {
  test.describe(`Settings tabs at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });
    test("sections are tabs, show one section at a time, and preserve keyboard navigation", async ({ page }) => {
      await page.goto("/settings");
      const tabs = page.getByRole("tablist", { name: "Settings sections" });
      await expect(tabs).toBeVisible(); await expect(tabs.getByRole("tab")).toHaveCount(6);
      await expect(page.getByRole("tabpanel", { name: "Identity" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Framework connection" })).toHaveCount(0);
      await page.getByRole("tab", { name: "Display", exact: true }).click();
      await expect(page.getByRole("region", { name: "Display" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Identity", exact: true })).toHaveCount(0);
      await page.getByRole("tab", { name: "Display", exact: true }).press("ArrowRight");
      await expect(page.getByRole("tab", { name: "Intelligence", selected: true })).toBeFocused();
      await page.getByRole("tab", { name: "Connection", exact: true }).click();
      await expect(page.getByRole("region", { name: "Framework connection" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(results.violations.map(v => v.id)).toEqual([]);
    });
  });
}
