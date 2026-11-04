import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// WK-E: contextual task inspector against design reference 02 (labelled mock fixture, src/mocks/humanGraph.ts).
const project = "00000000-0000-0000-0000-000000000001", approve = "00000000-0000-0000-0000-000000000104";
const scope = `scope=project:${project}`;
const evidence = process.env.EVIDENCE_DIR;

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}
const inspector = (page: Page) => page.locator("[data-task-inspector]");

for (const vp of [{ name: "desktop", width: 1440, height: 900 }, { name: "phone", width: 390, height: 844 }]) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("inspector leads with identity and one primary action row", async ({ page }) => {
      await page.goto(`/work/${approve}?${scope}`);
      const panel = inspector(page);
      const description = panel.getByRole("heading", { name: "Description" });
      await expect(description).toBeVisible();
      if (evidence) await page.screenshot({ path: `${evidence}/work-inspector-${vp.name}.png` });
      const descTop = (await description.boundingBox())!.y;
      const above = await panel.getByRole("button").evaluateAll((els, top) => els.filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.top < top;
      }).length, descTop);
      expect(above).toBeLessThanOrEqual(2);
      if (vp.name === "desktop") expect(descTop - (await panel.boundingBox())!.y).toBeLessThan(260);
      await expect(panel.getByText(/^Task · revision \d+$/i)).toBeVisible();
      await expect(panel.getByRole("link", { name: "Open full task" })).toBeVisible();
      await panel.getByRole("button", { name: "More actions" }).click();
      const menu = page.getByRole("menu");
      await expect(menu.getByRole("menuitem")).toHaveCount(4);
      if (evidence) await page.screenshot({ path: `${evidence}/work-inspector-menu-${vp.name}.png` });
      await axe(page);
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
      await expect(panel.getByRole("button", { name: "More actions" })).toBeFocused();
    });

    test("without task capabilities one shared reason replaces repeated hints", async ({ page }) => {
      // MSW serves bootstrap inside the page, so use the mock's labelled actions-unavailable scenario.
      await page.goto(`/work/${approve}?${scope}&scenario=actions-unavailable`);
      const panel = inspector(page);
      await expect(panel.getByRole("heading", { name: "Description" })).toBeVisible();
      if (evidence) await page.screenshot({ path: `${evidence}/work-inspector-nocaps-${vp.name}.png` });
      expect(await page.getByText("Not offered by this AQ server").count()).toBeLessThanOrEqual(1);
      await expect(panel.getByRole("note")).toHaveText("Task actions unavailable · Fixture scenario: actions are not offered");
      await expect(panel.getByRole("button", { name: "More actions" })).toHaveCount(0);
      await axe(page);
    });

    test("a missing task keeps an All tasks exit", async ({ page }) => {
      await page.goto(`/work/00000000-0000-0000-0000-0000000001ff?${scope}`);
      await expect(page.getByText("This item does not exist or is not available to you.")).toBeVisible();
      await expect(page.getByRole("link", { name: "All tasks" })).toBeVisible();
      if (evidence) await page.screenshot({ path: `${evidence}/work-inspector-notfound-${vp.name}.png` });
      await axe(page);
    });
  });
}
