import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Labelled mock fixtures (src/mocks/terminal.ts, src/mocks/results.ts) unblock
// visual review of Agents focus and Results in `vite --mode mock`.
const VIEWPORTS = [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "phone-390", width: 390, height: 844 },
];
const SHOTS = process.env.FIXTURE_SHOTS;

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
}

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("/agents/sess-07 watches labelled fixture output", async ({ page }) => {
      await page.goto("/agents/sess-07");
      const pane = page.getByRole("region", { name: "Interactive agent terminal" });
      await expect(pane.getByRole("status").filter({ hasText: "Watch only" })).toBeVisible();
      await expect(pane.locator(".xterm-rows")).toContainText("Fixture output for Worker 07");
      await expect(pane.locator(".xterm-rows")).toContainText("Tests: 1 failed, 20 passed, 21 total");
      await noOverflow(page);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/agents-focus-${vp.name}.png` });
      await axe(page);
    });

    test("/results shows fixture cards and opens the discussion", async ({ page }) => {
      await page.goto("/results");
      const feed = page.getByRole("list", { name: "Results feed" });
      await expect(feed.getByRole("article", { name: /^Result / })).toHaveCount(3);
      await expect(feed.getByRole("heading", { level: 2 }).first()).toHaveText(/^Fixture · /);
      await noOverflow(page);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/results-feed-${vp.name}.png` });
      await axe(page);
      await feed.getByRole("article", { name: /^Result / }).first().getByRole("button", { name: /^Comments 2/ }).click();
      // Desktop shows the side comments pane; narrower widths open the comments sheet.
      const discussion = page.getByRole("complementary", { name: "Discussion" }).or(page.getByRole("dialog", { name: /comments/i })).first();
      await expect(discussion.getByText("Fixture comment: the summary should name")).toBeVisible();
      await expect(discussion.getByText("Fixture comment: the caption wraps")).toBeVisible();
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/results-comments-${vp.name}.png` });
      await axe(page);
    });
  });
}
