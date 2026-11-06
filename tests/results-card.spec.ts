import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// RS-H: Results card header, status chip, density and footer against mocks
// 10 (desktop) and 13 (phone), using the labelled fixtures in src/mocks/results.ts.
const VIEWPORTS = [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "phone-390", width: 390, height: 844 },
];
const SHOTS = process.env.RS_H_SHOTS;

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("result cards follow the RS-H card anatomy", async ({ page }) => {
      await page.goto("/results");
      const cards = page.getByRole("list", { name: "Results feed" }).getByRole("article", { name: /^Result / });
      await expect(cards).toHaveCount(3);
      await expect(cards.first().getByRole("button", { name: /^Comments \d/ })).toBeVisible();

      for (const card of await cards.all()) {
        const footer = card.locator("footer");
        // No review flow exists for results yet, so no "Review result" dead end (RA-04); feedback creation lives in the discussion.
        await expect(footer.getByRole("link", { name: /review result/i })).toHaveCount(0);
        await expect(footer.getByRole("button", { name: "Create feedback task" })).toHaveCount(0);
        await expect(footer.getByText(/^Acceptance:/)).toBeVisible();
        // Relative time keeps the absolute timestamp in its title.
        await expect(card.locator("header time")).toHaveAttribute("title", /\d/);

        const box = (await card.boundingBox())!, chip = (await card.locator("[data-result-status]").boundingBox())!;
        expect(chip.x + chip.width / 2).toBeGreaterThan(box.x + box.width / 2);
        expect(chip.y + chip.height / 2).toBeLessThan(box.y + box.height / 2);
        if (vp.width >= 1440) expect(box.height).toBeLessThanOrEqual(520);

        const small = await card.evaluate((root) => {
          const out: string[] = [];
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const el = node.parentElement!;
            if (!node.textContent!.trim() || !el.checkVisibility()) continue;
            const size = parseFloat(getComputedStyle(el).fontSize);
            // The dashboard's type floor is 12px since the global step down (owner request 2026-11-06).
            if (size < 12) out.push(`${size}px ${node.textContent!.trim().slice(0, 40)}`);
          }
          return out;
        });
        expect(small).toEqual([]);
      }

      // Fixture assessments: first is flagged for review, the others carry the server's "unreviewed".
      await expect(cards.nth(0).locator("[data-result-status]")).toHaveText("Needs review");
      await expect(cards.nth(1).locator("[data-result-status]")).toHaveText("Submitted");
      // Comments is pressed for the selected card only.
      await expect(cards.nth(0).getByRole("button", { name: /^Comments/ })).toHaveAttribute("aria-pressed", "true");
      await expect(cards.nth(1).getByRole("button", { name: /^Comments/ })).toHaveAttribute("aria-pressed", "false");

      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/results-feed-${vp.name}.png` });
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);

      // Disclosure holds the moved exact-revision facts.
      await cards.first().getByText("Result context and evidence").click();
      await expect(cards.first().getByRole("link", { name: "Exact revision" })).toBeVisible();
    });
  });
}
