import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// KN-E (07-knowledge-v2.png; docs/specs/0002 §8/§9): phones open one full document page with an
// "All records" exit and "On this page" section navigation; desktop keeps the reference pane.
// Labelled mock fixture: src/mocks/humanGraph.ts "Fixture: execution ownership".
const project = "00000000-0000-0000-0000-000000000001", record = "00000000-0000-0000-0000-000000000005";
const evidence = process.env.EVIDENCE_DIR;
const BOTTOM_NAV = 64;

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}
async function openDocument(page: Page) {
  await page.goto(`/knowledge/${record}?scope=project:${project}`);
  await expect(page.getByRole("heading", { level: 2, name: "Fixture: execution ownership" })).toBeVisible({ timeout: 15_000 });
}
const documentPanel = (page: Page) => page.locator("section", { has: page.getByRole("heading", { level: 2, name: "Fixture: execution ownership" }) });

test.describe("390x844", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("document reads as a full-bleed page with section navigation clear of the bottom nav", async ({ page }) => {
    await openDocument(page);
    const back = page.getByRole("link", { name: "All records" });
    await expect(back).toBeVisible();
    // The exit precedes the document title.
    const title = page.getByRole("heading", { level: 2, name: "Fixture: execution ownership" });
    expect((await back.boundingBox())!.y).toBeLessThan((await title.boundingBox())!.y);

    const chrome = await documentPanel(page).evaluate((el) => { const s = getComputedStyle(el); return { border: s.borderTopWidth, radius: s.borderTopLeftRadius, background: s.backgroundColor }; });
    expect(chrome).toEqual({ border: "0px", radius: "0px", background: "rgba(0, 0, 0, 0)" });

    const outline = page.getByRole("navigation", { name: /On this page/ });
    await expect(outline.getByRole("link")).toHaveText(["Decision", "Why this matters"]);
    await expect(page.getByText("Record details")).toBeVisible();
    await axe(page);
    if (evidence) {
      await page.screenshot({ path: `${evidence}/knowledge-doc-after-m.png` });
      await outline.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${evidence}/knowledge-doc-after-outline-m.png` });
    }

    await outline.getByRole("link", { name: "Why this matters" }).click();
    const heading = page.getByRole("heading", { name: "Why this matters" });
    await expect(heading).toBeFocused();
    await expect(heading).toBeInViewport();
    const box = (await heading.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThan(844 - BOTTOM_NAV);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    if (evidence) await page.screenshot({ path: `${evidence}/knowledge-doc-after-jump-m.png` });
  });
});

test.describe("1440x900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("desktop keeps the bordered document pane and hides the phone outline and exit", async ({ page }) => {
    await openDocument(page);
    await expect(page.getByRole("list", { name: "Knowledge records" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: /On this page/ })).toBeHidden();
    await expect(page.getByRole("link", { name: "All records" })).toBeHidden();
    const border = await documentPanel(page).evaluate((el) => getComputedStyle(el).borderTopWidth);
    expect(border).toBe("1px");
    await expect(page.getByRole("heading", { name: "Why this matters" })).toBeVisible();
    await axe(page);
    if (evidence) await page.screenshot({ path: `${evidence}/knowledge-doc-after-d.png` });
  });
});
