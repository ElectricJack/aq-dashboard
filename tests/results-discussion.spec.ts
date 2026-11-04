import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

// RS-I: Results discussion panel against docs/design/10-results-desktop-v2.png and
// 13-results-mobile-v2.png, using the labelled fixtures in src/mocks/results.ts
// (two comments per result: one on the whole result, one pinned to an image region).
const SHOTS = process.env.FIXTURE_SHOTS;

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
}
async function threads(panel: Locator) {
  const toggles = panel.locator("h3 > button[aria-expanded]");
  await expect(toggles).toHaveCount(2);
  await expect(toggles.nth(0)).toHaveText(/Whole result/);
  await expect(toggles.nth(1)).toHaveText(/Image · pin 1/);
  const thread = panel.getByRole("region", { name: "Whole result" });
  await expect(thread.getByRole("button", { name: "Create feedback task" })).toBeVisible();
  await expect(thread.getByText("Links this comment and capture to new work.")).toBeVisible();
  await expect(thread.getByText("Fixture comment: the summary should name")).toBeVisible();
  // Collapsing a thread hides its comments and flips aria-expanded.
  await toggles.nth(1).click();
  await expect(toggles.nth(1)).toHaveAttribute("aria-expanded", "false");
  await expect(panel.getByText("Fixture comment: the caption wraps")).toBeHidden();
  await toggles.nth(1).click();
  await expect(panel.getByText("Fixture comment: the caption wraps")).toBeVisible();
}

test.describe("desktop-1440", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test("/results discussion panel is ~420px with anchored threads", async ({ page }) => {
    await page.goto("/results");
    const panel = page.getByRole("complementary", { name: "Discussion" });
    await expect(panel.getByRole("heading", { level: 2 })).toHaveText("Comments · 2");
    const box = await panel.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(400);
    expect(box!.width).toBeLessThanOrEqual(440);
    await threads(panel);
    await expect(panel.getByRole("textbox", { name: "Comment" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Post comment" })).toBeVisible();
    await noOverflow(page);
    if (SHOTS) {
      await page.screenshot({ path: `${SHOTS}/results-discussion-desktop-1440.png` });
      await panel.getByRole("button", { name: "Post comment" }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOTS}/results-discussion-desktop-1440-composer.png` });
    }
    await axe(page);
  });
});

test.describe("phone-390", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("/results comments sheet is full width with anchored threads", async ({ page }) => {
    await page.goto("/results");
    await page.getByRole("list", { name: "Results feed" }).getByRole("article").first().getByRole("button", { name: /^Comments 2/ }).click();
    const sheet = page.getByRole("dialog", { name: "Result comments" });
    await expect(sheet.getByRole("heading", { level: 2 })).toHaveText("Comments · 2");
    expect((await sheet.boundingBox())!.width).toBe(390);
    await threads(sheet);
    await expect(sheet.getByRole("button", { name: "Close comments" })).toBeVisible();
    if (SHOTS) {
      await page.screenshot({ path: `${SHOTS}/results-discussion-phone-390.png` });
      await sheet.getByRole("button", { name: "Post comment" }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOTS}/results-discussion-phone-390-composer.png` });
    }
    await axe(page);
  });
});
