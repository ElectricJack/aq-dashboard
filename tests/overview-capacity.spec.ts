import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const SHOTS = process.env.OVD_SHOTS;

async function axeClean(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target).join(", ")}`)).toEqual([]);
}

for (const vp of [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "phone-390", width: 390, height: 844 },
  { name: "phone-320", width: 320, height: 700 },
]) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("Capacity leads with open slots and keeps machine details one action away", async ({ page }) => {
      await page.goto("/overview");
      const capacity = page.getByRole("region", { name: "Capacity" });
      await expect(capacity).toContainText("1 open agent slot");
      await expect(capacity.getByRole("link", { name: "Open Swarm" })).toHaveAttribute("href", "/agents/swarm");
      await expect(capacity.getByRole("region", { name: "Tightest reported headroom" })).toBeVisible();
      await expect(capacity).toContainText("14% free");

      const pinned = page.getByRole("heading", { name: /pinned sessions/i });
      const capacityBox = (await capacity.boundingBox())!;
      const pinnedBox = (await pinned.boundingBox())!;
      expect(pinnedBox.y).toBeGreaterThan(capacityBox.y + capacityBox.height);
      if (vp.width === 1440) expect(pinnedBox.y + pinnedBox.height).toBeLessThan(900);

      const summary = capacity.locator("summary", { hasText: "By machine" });
      const hold = capacity.getByText("Capability report expired", { exact: true });
      await expect(hold).toBeHidden();
      if (vp.width < 1440) await capacity.scrollIntoViewIfNeeded();
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/overview-${vp.name}.png` });
      await axeClean(page);

      await summary.focus();
      await expect(summary).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(hold).toBeVisible();
      expect(await capacity.evaluate(element => element.scrollWidth)).toBeLessThanOrEqual((await capacity.boundingBox())!.width);
      await axeClean(page);
      if (SHOTS) await capacity.screenshot({ path: `${SHOTS}/capacity-${vp.name}-open.png` });
      await page.keyboard.press("Space");
      await expect(hold).toBeHidden();
    });
  });
}
