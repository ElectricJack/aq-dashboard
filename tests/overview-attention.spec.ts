import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/** OV-B: reference 01 attention rows (two lines, kind actions, "View all →"). Mock mode fixture. */
const EVIDENCE = process.env.OVB_EVIDENCE_DIR;

const VIEWPORTS = [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "phone-390", width: 390, height: 844 },
];

async function attentionRegion(page: Page) {
  await page.goto("/overview");
  const region = page.getByRole("region", { name: "Needs your attention" });
  await expect(region.locator("[data-attention-row]").first()).toBeVisible();
  return region;
}

type Box = { x: number; y: number; width: number; height: number };
const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("attention rows show kind actions, a View all link and pass axe", async ({ page }) => {
      const region = await attentionRegion(page);
      const viewAll = region.getByRole("link", { name: /view all/i });
      await expect(viewAll).toHaveAttribute("href", /\/decisions/);
      await expect(viewAll).toHaveText(/View all 3/);

      const question = region.locator("[data-attention-row][data-kind='question']");
      await expect(question.getByRole("link", { name: /answer/i })).toBeVisible();
      await expect(question.locator("svg[aria-hidden='true']").first()).toBeVisible();
      await expect(region.locator("[data-attention-row][data-kind='decision']").getByRole("link", { name: /^review/i })).toBeVisible();
      await expect(region.locator("[data-attention-row][data-kind='failed']").getByRole("link", { name: /^inspect/i })).toBeVisible();
      for (const action of await region.locator("[data-attention-row] a").all()) {
        await expect(action.locator("svg[aria-hidden='true']")).toHaveCount(1);
      }

      const rows = await region.locator("[data-attention-row]").all();
      expect(rows).toHaveLength(3);
      for (const row of rows) {
        const box = (await row.boundingBox())!;
        if (vp.width >= 1440) expect(box.height).toBeLessThanOrEqual(64);
        // Children never overlap each other, whether in one line or stacked.
        const parts = await row.locator(":scope > *").all();
        const boxes = (await Promise.all(parts.map((p) => p.boundingBox()))).filter((b): b is Box => !!b);
        for (let i = 0; i < boxes.length; i++)
          for (let j = i + 1; j < boxes.length; j++) expect(intersects(boxes[i]!, boxes[j]!)).toBe(false);
        const lines = row.locator("div > span");
        const [title, secondary] = [(await lines.nth(0).boundingBox())!, (await lines.nth(1).boundingBox())!];
        expect(intersects(title, secondary)).toBe(false);
        await expect(lines.nth(1)).toHaveAttribute("title", /·/);
      }

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(overflow).toBe(false);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);

      if (EVIDENCE) {
        await page.screenshot({ path: `${EVIDENCE}/overview-${vp.name}.png` });
        await region.screenshot({ path: `${EVIDENCE}/attention-${vp.name}.png` });
      }
    });
  });
}
