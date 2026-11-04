import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/** DC-J: reference 03 "Decision context" column (key/value, evidence cards, next steps). Mock mode fixture. */
const EVIDENCE = process.env.DCJ_EVIDENCE_DIR;
const DECISION = "00000000-0000-4000-8000-000000000001";

const VIEWPORTS = [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "phone-390", width: 390, height: 844 },
];

type Box = { x: number; y: number; width: number; height: number };
const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("decision context column is readable and passes axe", async ({ page }) => {
      await page.goto(`/decisions/${DECISION}`);
      const context = page.getByRole("region", { name: "Decision context" });
      await expect(context.locator("[data-evidence]").first()).toBeVisible();

      // Key/value: short ids with copy, task links to Work in its project, report to its results.
      await expect(context.getByText("00000000…0003")).toBeVisible();
      await expect(context.getByRole("button", { name: "Copy project id" })).toBeVisible();
      await expect(context.getByRole("link", { name: "00000000…0004" })).toHaveAttribute(
        "href", `/work/00000000-0000-4000-8000-000000000004?scope=${encodeURIComponent("project:00000000-0000-4000-8000-000000000003")}`);
      await expect(context.getByRole("link", { name: "00000000…0005" })).toHaveAttribute("href", /^\/results\?scope=project/);

      const cards = await context.locator("[data-evidence]").all();
      expect(cards).toHaveLength(5);
      for (const card of cards) {
        const label = (await card.locator("[data-evidence-label]").boundingBox())!;
        const id = (await card.locator("[data-evidence-id]").boundingBox())!;
        expect(intersects(label, id)).toBe(false);
        expect(id.y).toBeGreaterThanOrEqual(label.y + label.height - 1);
        const code = card.locator("code");
        await expect(code).toHaveText(/^[0-9a-f]{12}$/);
        await expect(code).toHaveAttribute("title", /^[0-9a-f]{64}$/);
        const { height, lineHeight } = await code.evaluate((el) => {
          const s = getComputedStyle(el);
          const lh = s.lineHeight === "normal" ? parseFloat(s.fontSize) * 1.25 : parseFloat(s.lineHeight);
          return { height: el.getBoundingClientRect().height, lineHeight: lh };
        });
        expect(height).toBeLessThanOrEqual(lineHeight + 0.5);
      }

      await expect(context.getByRole("heading", { name: "What happens next" })).toBeVisible();
      await expect(context.getByText(/^Revision checked \d+s ago$/)).toBeVisible();
      await expect(page.getByRole("link", { name: "Open Work" })).toHaveCount(0);

      // No text run longer than 24 characters without a break opportunity.
      const unbroken = await context.evaluate((root) => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const long: string[] = [];
        for (let n = walker.nextNode(); n; n = walker.nextNode())
          for (const run of (n.textContent ?? "").split(/[\s\-–—/·…]+/)) if (run.length > 24) long.push(run);
        return long;
      });
      expect(unbroken).toEqual([]);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(overflow).toBe(false);
      if (EVIDENCE) {
        await page.screenshot({ path: `${EVIDENCE}/decisions-context-${vp.name}.png`, fullPage: true });
        await context.screenshot({ path: `${EVIDENCE}/decisions-context-column-${vp.name}.png` });
      }
      const results = await new AxeBuilder({ page }).include("main").analyze();
      expect(results.violations).toEqual([]);
    });
  });
}
