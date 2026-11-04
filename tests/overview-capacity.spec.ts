import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// OV-D (nimble-lantern-11): reference 01 right column is Capacity (slots + provider status) then
// Pinned sessions; disk storage and worker nodes sit in a collapsed "More capacity" disclosure.
const SHOTS = process.env.OVD_SHOTS;

async function ready(page: Page) {
  await page.goto("/overview");
  await expect(page.getByRole("region", { name: "Needs your attention" }).getByRole("listitem").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /pinned sessions/i })).toBeVisible();
}

async function axeClean(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target).join(", ")}`)).toEqual([]);
}

for (const vp of [{ name: "desktop-1440", width: 1440, height: 900 }, { name: "phone-390", width: 390, height: 844 }]) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("Overview right column: compact Capacity, Pinned sessions, More capacity disclosure", async ({ page }) => {
      await ready(page);
      const capacity = page.getByRole("region", { name: "Capacity" });
      await expect(capacity.getByRole("link", { name: "Inspect eligibility →" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Inspect configuration →" })).toHaveCount(0);
      await expect(capacity.getByRole("heading", { name: "Provider status" })).toBeVisible();
      const outcomes = page.getByRole("region", { name: "Recent outcomes" });
      await expect(outcomes.getByRole("link", { name: "Activity →" })).toHaveAttribute("href", /^\/results/);

      const pinned = page.getByRole("heading", { name: /pinned sessions/i });
      const capacityBox = (await capacity.boundingBox())!;
      const pinnedBox = (await pinned.boundingBox())!;
      expect(pinnedBox.y).toBeGreaterThan(capacityBox.y + capacityBox.height);
      if (vp.width === 1440) expect(pinnedBox.y + pinnedBox.height).toBeLessThan(900);

      const summary = capacity.locator("summary", { hasText: "More capacity" });
      const disk = page.getByRole("heading", { name: "Disk storage" });
      const workers = page.getByRole("heading", { name: "Worker nodes" });
      await expect(disk).toBeHidden();
      await expect(workers).toBeHidden();
      if (vp.width < 1440) await capacity.scrollIntoViewIfNeeded();
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/overview-${vp.name}.png` });
      await axeClean(page);

      // Keyboard operable: focus the summary and toggle it with Enter and Space.
      await summary.focus();
      await expect(summary).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(disk).toBeVisible();
      await expect(workers).toBeVisible();
      await expect(capacity).toContainText("Not reported");
      await axeClean(page);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/overview-${vp.name}-more-open.png`, fullPage: vp.width === 1440 });
      await page.keyboard.press("Space");
      await expect(disk).toBeHidden();
    });
  });
}
